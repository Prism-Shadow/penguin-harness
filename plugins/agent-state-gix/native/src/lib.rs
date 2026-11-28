//! The Agent State / Git engine's native half: asynchronous in-process bare-repo operations on gitoxide.
//!
//! All disk and object-database I/O runs on Node's libuv worker pool via `AsyncTask`, so disk
//! reads, zlib compression/decompression, and object-database writes never block the JavaScript
//! event loop.
//!
//! `NativeRepo` holds an `Arc<gix::ThreadSafeRepository>` opened once per repository handle so
//! packfile indices and repository configuration are reused across calls, while bulk commits stream
//! files straight from disk into the ODB via `gix::objs::Write::write_stream` and extractions write
//! directly to an empty destination directory without routing file bytes through the JS heap.
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{Arc, RwLock};

use gix::objs::Write as _;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

/// Structured error encoded for TypeScript `GitError` decoding.
fn git_err(code: &str, message: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, format!("GIT_ERROR:{code}:{message}"))
}

fn refuse(message: String) -> Error {
    Error::new(Status::GenericFailure, message)
}

/// git's zone: `+hhmm` east of UTC, from the harness's offset in minutes.
fn zone_of(offset_minutes: f64) -> String {
    let offset = offset_minutes as i64;
    let abs = offset.abs();
    format!(
        "{}{:02}{:02}",
        if offset < 0 { "-" } else { "+" },
        abs / 60,
        abs % 60
    )
}

fn oid_of(hex: &str) -> Result<gix::hash::ObjectId> {
    gix::hash::ObjectId::from_hex(hex.as_bytes()).map_err(|e| {
        Error::new(
            Status::InvalidArg,
            format!("not a full hex object id: {hex} ({e})"),
        )
    })
}

fn is_safe_rel_path(rel: &str) -> bool {
    if rel.is_empty() || rel.starts_with('/') || rel.ends_with('/') || rel.contains('\\') || rel.contains('\0') {
        return false;
    }
    rel.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

fn join_prefix(prefix: &str, rel: &str) -> String {
    if prefix.is_empty() {
        rel.to_string()
    } else if rel.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}/{rel}")
    }
}

fn is_hex_oid(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Wraps a `File` and enforces exact expected length during streaming reads into the ODB.
struct ExactLenReader {
    file: File,
    expected: u64,
    read: u64,
}

impl Read for ExactLenReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.file.read(buf)?;
        self.read += n as u64;
        if self.read > self.expected {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SOURCE_CHANGED: file grew during read",
            ));
        }
        if n == 0 && self.read < self.expected {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "SOURCE_CHANGED: file shrank during read",
            ));
        }
        Ok(n)
    }
}

fn write_blob_from_file(repo: &gix::Repository, path: &str) -> Result<gix::hash::ObjectId> {
    let file = File::open(path)
        .map_err(|e| git_err("IO_ERROR", format!("cannot open {path}: {e}")))?;
    let expected = file
        .metadata()
        .map_err(|e| git_err("IO_ERROR", format!("cannot stat {path}: {e}")))?
        .len();
    let mut reader = ExactLenReader {
        file,
        expected,
        read: 0,
    };
    let oid = repo
        .objects
        .write_stream(gix::objs::Kind::Blob, expected, &mut reader)
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("SOURCE_CHANGED") {
                git_err("SOURCE_CHANGED", format!("{path} changed during read: {msg}"))
            } else {
                git_err("IO_ERROR", format!("cannot write blob from {path}: {msg}"))
            }
        })?;
    if reader.read != expected {
        return Err(git_err(
            "SOURCE_CHANGED",
            format!("{path} size changed during read (expected {expected}, read {})", reader.read),
        ));
    }
    let mut extra = [0u8; 1];
    match reader.file.read(&mut extra) {
        Ok(0) => Ok(oid),
        Ok(_) => Err(git_err(
            "SOURCE_CHANGED",
            format!("{path} grew during read (expected {expected})"),
        )),
        Err(e) => Err(git_err("IO_ERROR", format!("cannot verify EOF of {path}: {e}"))),
    }
}

fn subtree_oid(
    repo: &gix::Repository,
    commit_id: gix::hash::ObjectId,
    prefix: &str,
) -> Result<Option<gix::hash::ObjectId>> {
    let commit = match repo.find_commit(commit_id) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let mut tree_id = commit
        .tree_id()
        .map_err(|e| git_err("REPO_CORRUPT", format!("commit {commit_id} has no tree: {e}")))?
        .detach();
    if prefix.is_empty() {
        return Ok(Some(tree_id));
    }
    for segment in prefix.split('/') {
        let tree = repo
            .find_tree(tree_id)
            .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tree_id} missing: {e}")))?;
        let decoded = tree
            .decode()
            .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tree_id} malformed: {e}")))?;
        let mut found = None;
        for entry in decoded.entries {
            if entry.filename == segment.as_bytes() {
                if entry.mode.is_tree() {
                    found = Some(entry.oid.to_owned());
                }
                break;
            }
        }
        match found {
            Some(next) => tree_id = next,
            None => return Ok(None),
        }
    }
    Ok(Some(tree_id))
}

#[napi(object)]
pub struct NativeTreeEntry {
    pub rel: String,
    pub oid: String,
    pub mode: String,
    pub size: Option<f64>,
}

fn collect_tree_entries(
    repo: &gix::Repository,
    tree_id: gix::hash::ObjectId,
    base: &str,
    with_size: bool,
    out: &mut Vec<NativeTreeEntry>,
) -> Result<()> {
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tree_id} missing: {e}")))?;
    let decoded = tree
        .decode()
        .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tree_id} malformed: {e}")))?;
    for entry in decoded.entries {
        let name = String::from_utf8_lossy(entry.filename).into_owned();
        let rel = if base.is_empty() {
            name
        } else {
            format!("{base}/{name}")
        };
        if entry.mode.is_tree() {
            collect_tree_entries(repo, entry.oid.to_owned(), &rel, with_size, out)?;
        } else if entry.mode.is_commit() {
            // Skip submodules (160000), matching AgentStateRepo semantics.
            continue;
        } else {
            let oid = entry.oid.to_owned();
            let mode = if entry.mode.is_executable() {
                "100755".to_string()
            } else {
                "100644".to_string()
            };
            let size = if with_size {
                let hdr = repo
                    .find_header(oid)
                    .map_err(|e| git_err("REPO_CORRUPT", format!("object {oid} missing: {e}")))?;
                Some(hdr.size() as f64)
            } else {
                None
            };
            out.push(NativeTreeEntry {
                rel,
                oid: oid.to_string(),
                mode,
                size,
            });
        }
    }
    Ok(())
}

#[napi(object)]
pub struct NativeHeadInfo {
    pub ref_name: String,
    pub commit: Option<String>,
}

fn resolve_head_sync(repo: &gix::Repository) -> Result<NativeHeadInfo> {
    let gitdir = repo.git_dir();
    let head_raw = fs::read_to_string(gitdir.join("HEAD"))
        .map_err(|e| git_err("INVALID_REF", format!("cannot read HEAD: {e}")))?;
    let head_trimmed = head_raw.trim();
    let ref_name = head_trimmed
        .strip_prefix("ref: ")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| git_err("INVALID_REF", format!("{} has a detached or unreadable HEAD", gitdir.display())))?
        .to_string();

    let loose_path = gitdir.join(&ref_name);
    match fs::read_to_string(&loose_path) {
        Ok(content) => {
            let trimmed = content.trim();
            if !is_hex_oid(trimmed) {
                return Err(git_err(
                    "INVALID_REF",
                    format!("{ref_name} in {} is not a commit id", gitdir.display()),
                ));
            }
            return Ok(NativeHeadInfo {
                ref_name,
                commit: Some(trimmed.to_string()),
            });
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(git_err(
                "IO_ERROR",
                format!("cannot read {ref_name}: {e}"),
            ));
        }
    }

    let packed_path = gitdir.join("packed-refs");
    match fs::read_to_string(&packed_path) {
        Ok(content) => {
            for line in content.lines() {
                if line.is_empty() || line.starts_with('#') || line.starts_with('^') {
                    continue;
                }
                if let Some((oid, name)) = line.split_once(' ') {
                    if name == ref_name {
                        if !is_hex_oid(oid) {
                            return Err(git_err(
                                "INVALID_REF",
                                format!("{ref_name} in packed-refs is not a commit id"),
                            ));
                        }
                        return Ok(NativeHeadInfo {
                            ref_name,
                            commit: Some(oid.to_string()),
                        });
                    }
                }
            }
            Ok(NativeHeadInfo {
                ref_name,
                commit: None,
            })
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(NativeHeadInfo {
            ref_name,
            commit: None,
        }),
        Err(e) => Err(git_err("IO_ERROR", format!("cannot read packed-refs: {e}"))),
    }
}

#[napi(object)]
pub struct NativeHistoryEntry {
    pub commit: String,
    pub tree: String,
    pub committer_time: f64,
}

fn walk_history_sync(
    repo: &gix::Repository,
    from_commit: &str,
    prefix: &str,
    limit: usize,
    max_walk: usize,
) -> Result<Vec<NativeHistoryEntry>> {
    let mut out = Vec::new();
    let start_id = oid_of(from_commit).map_err(|e| git_err("INVALID_OID", e.reason))?;
    let mut oid = Some(start_id);
    let mut tree = subtree_oid(repo, start_id, prefix)?;
    let current = tree;
    let mut oldest: Option<(gix::hash::ObjectId, i64)> = None;
    let mut walked = 0usize;

    while let (Some(curr_oid), Some(curr_tree)) = (oid, tree) {
        if out.len() >= limit || walked >= max_walk {
            break;
        }
        walked += 1;
        let commit = match repo.find_commit(curr_oid) {
            Ok(c) => c,
            Err(_) => break,
        };
        let decoded = commit
            .decode()
            .map_err(|e| git_err("REPO_CORRUPT", format!("commit {curr_oid} malformed: {e}")))?;
        let committer_time = decoded
            .committer()
            .map_err(|e| git_err("REPO_CORRUPT", format!("commit {curr_oid} committer invalid: {e}")))?
            .seconds();
        oldest = Some((curr_oid, committer_time));
        let parent = decoded.parents().next();
        let before = match parent {
            Some(p) => subtree_oid(repo, p, prefix)?,
            None => None,
        };
        if before != Some(curr_tree) {
            out.push(NativeHistoryEntry {
                commit: curr_oid.to_string(),
                tree: curr_tree.to_string(),
                committer_time: committer_time as f64,
            });
        }
        oid = parent;
        tree = before;
    }

    if out.is_empty() {
        if let (Some(curr_tree), Some((old_commit, old_time))) = (current, oldest) {
            out.push(NativeHistoryEntry {
                commit: old_commit.to_string(),
                tree: curr_tree.to_string(),
                committer_time: old_time as f64,
            });
        }
    }
    Ok(out)
}

#[napi(object)]
pub struct NativeExtractResult {
    pub files: Vec<String>,
    pub total_bytes: f64,
}

fn extract_tree_sync(
    repo: &gix::Repository,
    commit_oid: &str,
    prefix: &str,
    dest_dir: &str,
    only_paths: Option<&[String]>,
) -> Result<NativeExtractResult> {
    if !prefix.is_empty() && !is_safe_rel_path(prefix) {
        return Err(git_err("INVALID_PATH", format!("unsafe prefix: {prefix}")));
    }
    let only_set: Option<HashSet<&str>> = match only_paths {
        Some(paths) => {
            let mut set = HashSet::with_capacity(paths.len());
            for p in paths {
                if !is_safe_rel_path(p) {
                    return Err(git_err("INVALID_PATH", format!("unsafe onlyPaths entry: {p}")));
                }
                set.insert(p.as_str());
            }
            Some(set)
        }
        None => None,
    };

    let dest = Path::new(dest_dir);
    if dest.exists() {
        if !dest.is_dir() {
            return Err(git_err(
                "DEST_NOT_EMPTY",
                format!("{dest_dir} exists and is not a directory"),
            ));
        }
        let mut rd = fs::read_dir(dest)
            .map_err(|e| git_err("IO_ERROR", format!("cannot read {dest_dir}: {e}")))?;
        if rd.next().is_some() {
            return Err(git_err(
                "DEST_NOT_EMPTY",
                format!("{dest_dir} is not empty"),
            ));
        }
    } else {
        fs::create_dir_all(dest)
            .map_err(|e| git_err("IO_ERROR", format!("cannot create {dest_dir}: {e}")))?;
    }

    let cid = oid_of(commit_oid).map_err(|e| git_err("INVALID_OID", e.reason))?;
    let Some(root_tree) = subtree_oid(repo, cid, prefix)? else {
        return Ok(NativeExtractResult {
            files: Vec::new(),
            total_bytes: 0.0,
        });
    };

    let mut entries = Vec::new();
    collect_tree_entries(repo, root_tree, "", false, &mut entries)?;

    let mut files = Vec::new();
    let mut total_bytes: u64 = 0;

    for entry in entries {
        if let Some(ref only) = only_set {
            if !only.contains(entry.rel.as_str()) {
                continue;
            }
        }
        if !is_safe_rel_path(&entry.rel) {
            return Err(git_err(
                "INVALID_PATH",
                format!("tree entry has unsafe path: {}", entry.rel),
            ));
        }
        let blob_id = oid_of(&entry.oid).map_err(|e| git_err("REPO_CORRUPT", e.reason))?;
        let obj = repo
            .find_object(blob_id)
            .map_err(|e| git_err("REPO_CORRUPT", format!("blob {blob_id} missing: {e}")))?;
        let target = dest.join(&entry.rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| git_err("IO_ERROR", format!("cannot create parent for {}: {e}", entry.rel)))?;
        }
        let mut f = File::create(&target)
            .map_err(|e| git_err("IO_ERROR", format!("cannot create {}: {e}", target.display())))?;
        f.write_all(&obj.data)
            .map_err(|e| git_err("IO_ERROR", format!("cannot write {}: {e}", target.display())))?;
        #[cfg(unix)]
        if entry.mode == "100755" {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = f
                .metadata()
                .map_err(|e| git_err("IO_ERROR", format!("cannot stat {}: {e}", target.display())))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&target, perms)
                .map_err(|e| git_err("IO_ERROR", format!("cannot chmod {}: {e}", target.display())))?;
        }
        total_bytes += obj.data.len() as u64;
        files.push(entry.rel);
    }

    Ok(NativeExtractResult {
        files,
        total_bytes: total_bytes as f64,
    })
}

#[napi(object)]
pub struct IdentityInput {
    pub name: String,
    pub email: String,
    /// Whole seconds since the epoch.
    pub when_seconds: f64,
    /// The zone as minutes east of UTC.
    pub when_offset_minutes: f64,
}

#[napi(object)]
pub struct RepoCommitFileInput {
    pub rel: String,
    /// Present for `kind: "file"` (direct streaming from disk).
    pub file_path: Option<String>,
    /// Present for `kind: "bytes"`.
    pub body: Option<Buffer>,
    /// "100644" (default) or "100755".
    pub mode: Option<String>,
}

#[napi(object)]
pub struct RepoCommitInput {
    pub parent: Option<String>,
    pub prefix: String,
    /// "replace" or "patch"
    pub change_kind: String,
    /// For "replace": None removes prefix; Some(list) replaces prefix. For "patch": files to upsert.
    pub files: Option<Vec<RepoCommitFileInput>>,
    /// For "patch": relative paths under prefix to remove.
    pub remove: Option<Vec<String>>,
    pub message: String,
    pub author: IdentityInput,
    pub committer: IdentityInput,
}

#[napi(object)]
pub struct NativePreparedCommit {
    pub commit: String,
    pub tree: String,
}

fn signature_of(identity: &IdentityInput) -> Result<gix::actor::Signature> {
    let time_str = format!(
        "{} {}",
        identity.when_seconds as i64,
        zone_of(identity.when_offset_minutes)
    );
    let sig_ref = gix::actor::SignatureRef {
        name: identity.name.as_bytes().into(),
        email: identity.email.as_bytes().into(),
        time: &time_str,
    };
    sig_ref
        .to_owned()
        .map_err(|e| git_err("INVALID_PATH", format!("invalid signature time: {e}")))
}

fn prepare_commit_sync(
    repo: &gix::Repository,
    input: &RepoCommitInput,
) -> Result<NativePreparedCommit> {
    if !input.prefix.is_empty() && !is_safe_rel_path(&input.prefix) {
        return Err(git_err(
            "INVALID_PATH",
            format!("unsafe prefix: {}", input.prefix),
        ));
    }
    let parent = match input.parent.as_deref() {
        Some(hex) if !hex.is_empty() => {
            Some(oid_of(hex).map_err(|e| git_err("INVALID_OID", e.reason))?)
        }
        _ => None,
    };
    let parent_tree: gix::hash::ObjectId = match parent {
        Some(id) => repo
            .find_commit(id)
            .map_err(|e| git_err("PARENT_NOT_FOUND", format!("parent {id} is not in repository: {e}")))?
            .tree_id()
            .map_err(|e| git_err("REPO_CORRUPT", format!("parent {id} has no tree: {e}")))?
            .detach(),
        None => gix::hash::ObjectId::empty_tree(repo.object_hash()),
    };

    let foundation = if input.change_kind == "replace" && input.prefix.is_empty() {
        gix::hash::ObjectId::empty_tree(repo.object_hash())
    } else {
        parent_tree
    };

    let mut editor = repo
        .edit_tree(foundation)
        .map_err(|e| git_err("REPO_CORRUPT", format!("cannot edit tree: {e}")))?;

    match input.change_kind.as_str() {
        "replace" => {
            if !input.prefix.is_empty() && parent.is_some() {
                editor
                    .remove(input.prefix.as_str())
                    .map_err(|e| git_err("IO_ERROR", format!("cannot clear {}: {e}", input.prefix)))?;
            }
            if let Some(ref files) = input.files {
                for file in files {
                    if !is_safe_rel_path(&file.rel) {
                        return Err(git_err("INVALID_PATH", format!("unsafe path: {}", file.rel)));
                    }
                    let blob_id = match (&file.file_path, &file.body) {
                        (Some(path), _) => write_blob_from_file(repo, path)?,
                        (None, Some(buf)) => repo
                            .write_blob(buf.as_ref())
                            .map_err(|e| git_err("IO_ERROR", format!("cannot write {}: {e}", file.rel)))?
                            .detach(),
                        (None, None) => {
                            return Err(git_err(
                                "INVALID_PATH",
                                format!("file {} has neither filePath nor body", file.rel),
                            ));
                        }
                    };
                    let kind = match file.mode.as_deref() {
                        Some("100755") => gix::object::tree::EntryKind::BlobExecutable,
                        _ => gix::object::tree::EntryKind::Blob,
                    };
                    let full_path = join_prefix(&input.prefix, &file.rel);
                    editor
                        .upsert(full_path.as_str(), kind, blob_id)
                        .map_err(|e| git_err("IO_ERROR", format!("cannot upsert {full_path}: {e}")))?;
                }
            }
        }
        "patch" => {
            if let Some(ref removes) = input.remove {
                for rel in removes {
                    if !is_safe_rel_path(rel) {
                        return Err(git_err("INVALID_PATH", format!("unsafe remove path: {rel}")));
                    }
                    let full_path = join_prefix(&input.prefix, rel);
                    editor
                        .remove(full_path.as_str())
                        .map_err(|e| git_err("IO_ERROR", format!("cannot remove {full_path}: {e}")))?;
                }
            }
            if let Some(ref files) = input.files {
                for file in files {
                    if !is_safe_rel_path(&file.rel) {
                        return Err(git_err("INVALID_PATH", format!("unsafe path: {}", file.rel)));
                    }
                    let blob_id = match (&file.file_path, &file.body) {
                        (Some(path), _) => write_blob_from_file(repo, path)?,
                        (None, Some(buf)) => repo
                            .write_blob(buf.as_ref())
                            .map_err(|e| git_err("IO_ERROR", format!("cannot write {}: {e}", file.rel)))?
                            .detach(),
                        (None, None) => {
                            return Err(git_err(
                                "INVALID_PATH",
                                format!("file {} has neither filePath nor body", file.rel),
                            ));
                        }
                    };
                    let kind = match file.mode.as_deref() {
                        Some("100755") => gix::object::tree::EntryKind::BlobExecutable,
                        _ => gix::object::tree::EntryKind::Blob,
                    };
                    let full_path = join_prefix(&input.prefix, &file.rel);
                    editor
                        .upsert(full_path.as_str(), kind, blob_id)
                        .map_err(|e| git_err("IO_ERROR", format!("cannot upsert {full_path}: {e}")))?;
                }
            }
        }
        other => {
            return Err(git_err(
                "INVALID_PATH",
                format!("unknown change_kind: {other}"),
            ));
        }
    }

    let tree_id = editor
        .write()
        .map_err(|e| git_err("IO_ERROR", format!("cannot write tree: {e}")))?
        .detach();

    let commit_obj = gix::objs::Commit {
        tree: tree_id,
        parents: parent.into_iter().collect(),
        author: signature_of(&input.author)?,
        committer: signature_of(&input.committer)?,
        encoding: None,
        message: input.message.as_str().into(),
        extra_headers: Default::default(),
    };
    let commit_id = repo
        .write_object(&commit_obj)
        .map_err(|e| git_err("IO_ERROR", format!("cannot write commit object: {e}")))?
        .detach();

    Ok(NativePreparedCommit {
        commit: commit_id.to_string(),
        tree: tree_id.to_string(),
    })
}

fn cas_ref_sync(
    repo: &gix::Repository,
    ref_name: &str,
    new_commit: &str,
    expected_parent: Option<&str>,
) -> Result<()> {
    use gix::refs::transaction::{PreviousValue, RefEdit};
    use gix::refs::{FullName, Target};

    let full_name: FullName = ref_name
        .try_into()
        .map_err(|e| git_err("INVALID_REF", format!("invalid ref name {ref_name}: {e}")))?;
    let new_id = oid_of(new_commit).map_err(|e| git_err("INVALID_OID", e.reason))?;
    let expected = match expected_parent {
        Some(hex) if !hex.is_empty() => {
            let old_id = oid_of(hex).map_err(|e| git_err("INVALID_OID", e.reason))?;
            PreviousValue::MustExistAndMatch(Target::Object(old_id))
        }
        _ => PreviousValue::MustNotExist,
    };
    let edit = RefEdit::update(full_name, new_id, expected, "");
    repo.edit_reference(edit)
        .map_err(|e| git_err("CAS_CONFLICT", format!("ref update refused for {ref_name}: {e}")))?;
    Ok(())
}

// ---- NativeRepo handle & AsyncTasks ------------------------------------------------

#[napi]
pub struct NativeRepo {
    inner: RwLock<Option<Arc<gix::ThreadSafeRepository>>>,
}

impl NativeRepo {
    fn sync_repo(&self) -> Result<Arc<gix::ThreadSafeRepository>> {
        let guard = self
            .inner
            .read()
            .map_err(|_| git_err("IO_ERROR", "repo lock poisoned"))?;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| git_err("IO_ERROR", "GitRepo has been closed"))
    }
}

pub struct OpenRepoTask {
    gitdir: String,
}

impl Task for OpenRepoTask {
    type Output = Arc<gix::ThreadSafeRepository>;
    type JsValue = NativeRepo;

    fn compute(&mut self) -> Result<Self::Output> {
        let repo = gix::open(&self.gitdir)
            .map_err(|e| git_err("IO_ERROR", format!("gitoxide cannot open {}: {e}", self.gitdir)))?;
        Ok(Arc::new(repo.into_sync()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeRepo {
            inner: RwLock::new(Some(output)),
        })
    }
}

#[napi]
pub fn open_repo(gitdir: String) -> AsyncTask<OpenRepoTask> {
    AsyncTask::new(OpenRepoTask { gitdir })
}

pub struct ResolveHeadTask {
    repo: Arc<gix::ThreadSafeRepository>,
}

impl Task for ResolveHeadTask {
    type Output = NativeHeadInfo;
    type JsValue = NativeHeadInfo;

    fn compute(&mut self) -> Result<Self::Output> {
        resolve_head_sync(&self.repo.to_thread_local())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct ListTreeTask {
    repo: Arc<gix::ThreadSafeRepository>,
    commit_oid: String,
    prefix: String,
    with_size: bool,
}

impl Task for ListTreeTask {
    type Output = Option<Vec<NativeTreeEntry>>;
    type JsValue = Option<Vec<NativeTreeEntry>>;

    fn compute(&mut self) -> Result<Self::Output> {
        let local = self.repo.to_thread_local();
        let cid = oid_of(&self.commit_oid).map_err(|e| git_err("INVALID_OID", e.reason))?;
        let Some(tree_id) = subtree_oid(&local, cid, &self.prefix)? else {
            return Ok(None);
        };
        let mut out = Vec::new();
        collect_tree_entries(&local, tree_id, "", self.with_size, &mut out)?;
        Ok(Some(out))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct WalkHistoryTask {
    repo: Arc<gix::ThreadSafeRepository>,
    from_commit: String,
    prefix: String,
    limit: usize,
    max_walk: usize,
}

impl Task for WalkHistoryTask {
    type Output = Vec<NativeHistoryEntry>;
    type JsValue = Vec<NativeHistoryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        walk_history_sync(
            &self.repo.to_thread_local(),
            &self.from_commit,
            &self.prefix,
            self.limit,
            self.max_walk,
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct ExtractTreeTask {
    repo: Arc<gix::ThreadSafeRepository>,
    commit_oid: String,
    prefix: String,
    dest_dir: String,
    only_paths: Option<Vec<String>>,
}

impl Task for ExtractTreeTask {
    type Output = NativeExtractResult;
    type JsValue = NativeExtractResult;

    fn compute(&mut self) -> Result<Self::Output> {
        extract_tree_sync(
            &self.repo.to_thread_local(),
            &self.commit_oid,
            &self.prefix,
            &self.dest_dir,
            self.only_paths.as_deref(),
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct PrepareCommitTask {
    repo: Arc<gix::ThreadSafeRepository>,
    input: RepoCommitInput,
}

impl Task for PrepareCommitTask {
    type Output = NativePreparedCommit;
    type JsValue = NativePreparedCommit;

    fn compute(&mut self) -> Result<Self::Output> {
        prepare_commit_sync(&self.repo.to_thread_local(), &self.input)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct CasRefTask {
    repo: Arc<gix::ThreadSafeRepository>,
    ref_name: String,
    new_commit: String,
    expected_parent: Option<String>,
}

impl Task for CasRefTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        cas_ref_sync(
            &self.repo.to_thread_local(),
            &self.ref_name,
            &self.new_commit,
            self.expected_parent.as_deref(),
        )
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
impl NativeRepo {
    #[napi]
    pub fn resolve_head(&self) -> Result<AsyncTask<ResolveHeadTask>> {
        Ok(AsyncTask::new(ResolveHeadTask {
            repo: self.sync_repo()?,
        }))
    }

    #[napi]
    pub fn list_tree(
        &self,
        commit_oid: String,
        prefix: String,
        with_size: bool,
    ) -> Result<AsyncTask<ListTreeTask>> {
        Ok(AsyncTask::new(ListTreeTask {
            repo: self.sync_repo()?,
            commit_oid,
            prefix,
            with_size,
        }))
    }

    #[napi]
    pub fn walk_history(
        &self,
        from_commit: String,
        prefix: String,
        limit: u32,
        max_walk: u32,
    ) -> Result<AsyncTask<WalkHistoryTask>> {
        Ok(AsyncTask::new(WalkHistoryTask {
            repo: self.sync_repo()?,
            from_commit,
            prefix,
            limit: limit as usize,
            max_walk: max_walk as usize,
        }))
    }

    #[napi]
    pub fn extract_tree(
        &self,
        commit_oid: String,
        prefix: String,
        dest_dir: String,
        only_paths: Option<Vec<String>>,
    ) -> Result<AsyncTask<ExtractTreeTask>> {
        Ok(AsyncTask::new(ExtractTreeTask {
            repo: self.sync_repo()?,
            commit_oid,
            prefix,
            dest_dir,
            only_paths,
        }))
    }

    #[napi]
    pub fn prepare_commit(&self, input: RepoCommitInput) -> Result<AsyncTask<PrepareCommitTask>> {
        Ok(AsyncTask::new(PrepareCommitTask {
            repo: self.sync_repo()?,
            input,
        }))
    }

    #[napi]
    pub fn cas_ref(
        &self,
        ref_name: String,
        new_commit: String,
        expected_parent: Option<String>,
    ) -> Result<AsyncTask<CasRefTask>> {
        Ok(AsyncTask::new(CasRefTask {
            repo: self.sync_repo()?,
            ref_name,
            new_commit,
            expected_parent,
        }))
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        if let Ok(mut guard) = self.inner.write() {
            *guard = None;
        }
        Ok(())
    }
}

// ---- Legacy AgentStateEngine exports (kept during transition) ----------------------

#[napi(object)]
pub struct FileEntry {
    pub rel: String,
    pub body: Buffer,
}

#[napi(object)]
pub struct CommitInput {
    pub gitdir: String,
    pub ref_name: String,
    pub parent: Option<String>,
    pub rel: String,
    pub files: Option<Vec<FileEntry>>,
    pub message: String,
    pub author: IdentityInput,
    pub committer: IdentityInput,
}

fn commit_sync(input: &CommitInput) -> Result<String> {
    let repo = gix::open(&input.gitdir)
        .map_err(|e| refuse(format!("gitoxide cannot open {}: {e}", input.gitdir)))?;
    let parent = match input.parent.as_deref() {
        Some(hex) if !hex.is_empty() => Some(oid_of(hex)?),
        _ => None,
    };
    let foundation: gix::hash::ObjectId = match parent {
        Some(id) => repo
            .find_commit(id)
            .map_err(|e| {
                refuse(format!(
                    "parent {} is not in the repository: {e}",
                    input.parent.as_deref().unwrap_or("")
                ))
            })?
            .tree_id()
            .map_err(|e| refuse(format!("parent has no tree: {e}")))?
            .detach(),
        None => gix::hash::ObjectId::empty_tree(repo.object_hash()),
    };

    let mut editor = repo
        .edit_tree(foundation)
        .map_err(|e| refuse(format!("gitoxide cannot edit the parent's tree: {e}")))?;
    match &input.files {
        None => {
            if parent.is_some() {
                editor
                    .remove(input.rel.as_str())
                    .map_err(|e| refuse(format!("cannot remove {}: {e}", input.rel)))?;
            }
        }
        Some(files) => {
            if parent.is_some() {
                editor
                    .remove(input.rel.as_str())
                    .map_err(|e| refuse(format!("cannot replace {}: {e}", input.rel)))?;
            }
            for file in files {
                let blob = repo
                    .write_blob(file.body.as_ref())
                    .map_err(|e| refuse(format!("cannot write {}: {e}", file.rel)))?;
                let path = format!("{}/{}", input.rel, file.rel);
                editor
                    .upsert(path.as_str(), gix::object::tree::EntryKind::Blob, blob.detach())
                    .map_err(|e| refuse(format!("cannot add {}: {e}", file.rel)))?;
            }
        }
    }
    let tree = editor
        .write()
        .map_err(|e| refuse(format!("cannot write the tree: {e}")))?;

    let committer = signature_of(&input.committer)?;
    let author = signature_of(&input.author)?;
    let commit_obj = gix::objs::Commit {
        tree: tree.detach(),
        parents: parent.into_iter().collect(),
        author,
        committer,
        encoding: None,
        message: input.message.as_str().into(),
        extra_headers: Default::default(),
    };
    let id = repo
        .write_object(&commit_obj)
        .map_err(|e| refuse(format!("gitoxide refused the write: {e}")))?
        .detach();
    cas_ref_sync(&repo, &input.ref_name, &id.to_string(), input.parent.as_deref())
        .map_err(|e| refuse(format!("gitoxide refused the write: {}", e.reason)))?;
    Ok(id.to_string())
}

pub struct CommitTask {
    input: CommitInput,
}

impl Task for CommitTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        commit_sync(&self.input)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn commit(input: CommitInput) -> AsyncTask<CommitTask> {
    AsyncTask::new(CommitTask { input })
}

fn read_objects_sync(gitdir: &str, oids: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
    let repo = gix::open(gitdir)
        .map_err(|e| refuse(format!("gitoxide cannot open {gitdir}: {e}")))?;
    let mut out = Vec::with_capacity(oids.len());
    for hex in oids {
        let id = oid_of(hex)?;
        match repo.find_object(id) {
            Ok(mut object) => out.push(Some(std::mem::take(&mut object.data))),
            Err(_) => out.push(None),
        }
    }
    Ok(out)
}

pub struct ReadObjectsTask {
    gitdir: String,
    oids: Vec<String>,
}

impl Task for ReadObjectsTask {
    type Output = Vec<Option<Vec<u8>>>;
    type JsValue = Vec<Option<Buffer>>;

    fn compute(&mut self) -> Result<Self::Output> {
        read_objects_sync(&self.gitdir, &self.oids)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(|opt| opt.map(Buffer::from)).collect())
    }
}

#[napi]
pub fn read_objects(gitdir: String, oids: Vec<String>) -> AsyncTask<ReadObjectsTask> {
    AsyncTask::new(ReadObjectsTask { gitdir, oids })
}

/// Who the native half runs as, for the engine's log line.
#[napi]
pub fn engine_version() -> String {
    format!("gitoxide {}", env!("GIX_VERSION"))
}
