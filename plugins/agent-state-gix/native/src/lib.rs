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

/// Rejects SharedArrayBuffer-backed buffers before Rust ever constructs `&[u8]`.
pub struct SafeBytes(pub Vec<u8>);

impl napi::bindgen_prelude::TypeName for SafeBytes {
    fn type_name() -> &'static str {
        "Buffer"
    }
    fn value_type() -> napi::ValueType {
        napi::ValueType::Object
    }
}

impl napi::bindgen_prelude::ValidateNapiValue for SafeBytes {}

impl napi::bindgen_prelude::ToNapiValue for SafeBytes {
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> Result<napi::sys::napi_value> {
        <Buffer as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, Buffer::from(val.0))
    }
}

impl napi::bindgen_prelude::FromNapiValue for SafeBytes {
    unsafe fn from_napi_value(
        env: napi::sys::napi_env,
        napi_val: napi::sys::napi_value,
    ) -> Result<Self> {
        let mut is_ta = false;
        let status = napi::sys::napi_is_typedarray(env, napi_val, &mut is_ta);
        if status != napi::sys::Status::napi_ok || !is_ta {
            return Err(git_err("INVALID_PATH", "expected Buffer or Uint8Array for file body"));
        }
        let mut ta_type: napi::sys::napi_typedarray_type = 0;
        let mut byte_len: usize = 0;
        let mut data: *mut std::ffi::c_void = std::ptr::null_mut();
        let mut arraybuffer: napi::sys::napi_value = std::ptr::null_mut();
        let mut byte_offset: usize = 0;
        let status = napi::sys::napi_get_typedarray_info(
            env,
            napi_val,
            &mut ta_type,
            &mut byte_len,
            &mut data,
            &mut arraybuffer,
            &mut byte_offset,
        );
        if status != napi::sys::Status::napi_ok {
            return Err(git_err("INVALID_PATH", "failed to inspect file body buffer"));
        }
        // Reject wider typed arrays (e.g. Uint16Array) where `byte_len` is element count, not bytes (Minor #8).
        if ta_type != napi::sys::TypedarrayType::uint8_array
            && ta_type != napi::sys::TypedarrayType::uint8_clamped_array
        {
            return Err(git_err(
                "INVALID_PATH",
                "expected Buffer or Uint8Array for file body",
            ));
        }
        // Node-API `napi_is_arraybuffer` returns true ONLY for non-shared ArrayBuffer (false for SharedArrayBuffer).
        let mut is_ab = false;
        let ab_status = napi::sys::napi_is_arraybuffer(env, arraybuffer, &mut is_ab);
        if ab_status != napi::sys::Status::napi_ok || !is_ab {
            return Err(git_err(
                "INVALID_PATH",
                "SharedArrayBuffer-backed buffers are not supported",
            ));
        }
        if byte_len == 0 || data.is_null() {
            return Ok(SafeBytes(Vec::new()));
        }
        let slice = std::slice::from_raw_parts(data as *const u8, byte_len);
        Ok(SafeBytes(slice.to_vec()))
    }
}

fn is_safe_rel_path(rel: &str) -> bool {
    if rel.is_empty() || rel.starts_with('/') || rel.ends_with('/') {
        return false;
    }
    if rel.bytes().any(|b| b == 0 || b == b'\\' || b == b':') {
        return false;
    }
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return false;
        }
        if seg.ends_with(' ') || seg.ends_with('.') {
            return false;
        }
        // Reject `.git` (case-insensitive) to match Git's update-index/verify_path rules.
        if seg.eq_ignore_ascii_case(".git") {
            return false;
        }
        let stem = seg.split('.').next().unwrap_or(seg);
        let upper = stem.to_ascii_uppercase();
        if matches!(
            upper.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) {
            return false;
        }
    }
    true
}
#[cfg(windows)]
fn is_win32_extractable_path(rel: &str) -> bool {
    // Reject characters forbidden by Win32 filesystems before writing any entry (Minor #5).
    !rel.bytes().any(|b| {
        b < 0x20 || matches!(b, b'<' | b'>' | b'"' | b'|' | b'?' | b'*')
    })
}

#[cfg(not(windows))]
fn is_win32_extractable_path(_rel: &str) -> bool {
    true
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

fn open_regular_source_file(path: &str) -> Result<File> {
    // Reject symlinks and non-regular files (e.g. FIFOs/sockets/dirs) BEFORE opening so a FIFO
    // cannot stall libuv workers indefinitely.
    let lmeta = fs::symlink_metadata(path)
        .map_err(|e| git_err("IO_ERROR", format!("cannot lstat {path}: {e}")))?;
    if !lmeta.file_type().is_file() {
        return Err(git_err(
            "INVALID_PATH",
            format!("source path is not a regular file: {path}"),
        ));
    }
    let mut opts = fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = opts
        .open(path)
        .map_err(|e| git_err("IO_ERROR", format!("cannot open {path}: {e}")))?;
    let fmeta = file
        .metadata()
        .map_err(|e| git_err("IO_ERROR", format!("cannot fstat {path}: {e}")))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if (fmeta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return Err(git_err(
                "INVALID_PATH",
                format!("opened descriptor is a reparse point: {path}"),
            ));
        }
    }
    if !fmeta.is_file() {
        return Err(git_err(
            "INVALID_PATH",
            format!("opened descriptor is not a regular file: {path}"),
        ));
    }
    Ok(file)
}

fn write_blob_from_file(repo: &gix::Repository, path: &str) -> Result<gix::hash::ObjectId> {
    let file = open_regular_source_file(path)?;
    let before = file
        .metadata()
        .map_err(|e| git_err("IO_ERROR", format!("cannot stat {path}: {e}")))?;
    let expected = before.len();
    let before_mtime = before.modified().ok();
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
        Ok(0) => {}
        Ok(_) => {
            return Err(git_err(
                "SOURCE_CHANGED",
                format!("{path} grew during read (expected {expected})"),
            ))
        }
        Err(e) => return Err(git_err("IO_ERROR", format!("cannot verify EOF of {path}: {e}"))),
    }
    let after = reader
        .file
        .metadata()
        .map_err(|e| git_err("IO_ERROR", format!("cannot restat {path}: {e}")))?;
    if after.len() != expected || (before_mtime.is_some() && after.modified().ok() != before_mtime) {
        return Err(git_err(
            "SOURCE_CHANGED",
            format!("{path} metadata changed during read"),
        ));
    }
    // Check pathname replacement parity with CLI/Dugite (Minor #7): reject if the pathname now
    // points to a different inode, non-regular file, missing path, or modified metadata.
    let post_lstat = fs::symlink_metadata(path).map_err(|e| {
        git_err(
            "SOURCE_CHANGED",
            format!("{path} disappeared during read: {e}"),
        )
    })?;
    if !post_lstat.file_type().is_file()
        || post_lstat.len() != expected
        || (before_mtime.is_some() && post_lstat.modified().ok() != before_mtime)
    {
        return Err(git_err(
            "SOURCE_CHANGED",
            format!("{path} replaced during read"),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if post_lstat.dev() != before.dev() || post_lstat.ino() != before.ino() {
            return Err(git_err(
                "SOURCE_CHANGED",
                format!("{path} inode replaced during read"),
            ));
        }
    }
    Ok(oid)
}

fn subtree_oid(
    repo: &gix::Repository,
    commit_id: gix::hash::ObjectId,
    prefix: &str,
) -> Result<Option<gix::hash::ObjectId>> {
    let commit = match repo.try_find_object(commit_id) {
        Ok(Some(obj)) => obj
            .try_into_commit()
            .map_err(|e| git_err("INVALID_OID", format!("{commit_id} is not a commit: {e}")))?,
        Ok(None) => return Ok(None),
        Err(e) => return Err(git_err("REPO_CORRUPT", format!("cannot read commit {commit_id}: {e}"))),
    };
    let mut tree_id = commit
        .tree_id()
        .map_err(|e| git_err("REPO_CORRUPT", format!("commit {commit_id} has no tree: {e}")))?
        .detach();
    if !prefix.is_empty() {
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
    }
    // Validate that the final subtree OID actually exists as a tree object (Major #9).
    let _final_tree = repo
        .find_tree(tree_id)
        .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tree_id} missing or corrupt: {e}")))?;
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
    // Heap-iterative DFS preserving exact depth-first Git entry order with no artificial depth cap
    // (Minor #9); active-path cycle detection guards against corrupt self-referencing trees.
    let mut frames: Vec<(gix::hash::ObjectId, Vec<EitherEntry>)> = Vec::new();
    let mut active_trees: HashSet<gix::hash::ObjectId> = HashSet::new();

    let push_tree = |repo: &gix::Repository,
                     tid: gix::hash::ObjectId,
                     b: String,
                     frames: &mut Vec<(gix::hash::ObjectId, Vec<EitherEntry>)>,
                     active_trees: &mut HashSet<gix::hash::ObjectId>|
     -> Result<()> {
        if !active_trees.insert(tid) {
            return Err(git_err(
                "REPO_CORRUPT",
                format!("cyclic tree reference detected at {tid}"),
            ));
        }
        let tree = repo
            .find_tree(tid)
            .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tid} missing: {e}")))?;
        let decoded = tree
            .decode()
            .map_err(|e| git_err("REPO_CORRUPT", format!("tree {tid} malformed: {e}")))?;
        let mut items = Vec::with_capacity(decoded.entries.len());
        for entry in decoded.entries {
            // Check entry mode BEFORE decoding filename so non-UTF-8 submodules/symlinks are skipped
            // per contract (Minor #4).
            let kind = entry.mode.kind();
            match kind {
                gix::object::tree::EntryKind::Tree => {
                    let name = std::str::from_utf8(entry.filename.as_ref())
                        .map_err(|_| {
                            git_err("INVALID_PATH", format!("non-UTF-8 tree entry name in tree {tid}"))
                        })?
                        .to_owned();
                    let rel = if b.is_empty() {
                        name
                    } else {
                        format!("{b}/{name}")
                    };
                    items.push(EitherEntry::Tree(entry.oid.to_owned(), rel));
                }
                gix::object::tree::EntryKind::Blob | gix::object::tree::EntryKind::BlobExecutable => {
                    let name = std::str::from_utf8(entry.filename.as_ref())
                        .map_err(|_| {
                            git_err("INVALID_PATH", format!("non-UTF-8 tree entry name in tree {tid}"))
                        })?
                        .to_owned();
                    let rel = if b.is_empty() {
                        name
                    } else {
                        format!("{b}/{name}")
                    };
                    let mode_str = if matches!(kind, gix::object::tree::EntryKind::BlobExecutable) {
                        "100755"
                    } else {
                        "100644"
                    };
                    let size = if with_size {
                        let hdr = repo.find_header(entry.oid).map_err(|e| {
                            git_err("REPO_CORRUPT", format!("blob {} missing: {e}", entry.oid))
                        })?;
                        if hdr.kind() != gix::object::Kind::Blob {
                            return Err(git_err(
                                "REPO_CORRUPT",
                                format!("entry {rel} points to {:?}, expected blob", hdr.kind()),
                            ));
                        }
                        Some(hdr.size() as f64)
                    } else {
                        None
                    };
                    items.push(EitherEntry::Blob(NativeTreeEntry {
                        rel,
                        oid: entry.oid.to_string(),
                        mode: mode_str.to_string(),
                        size,
                    }));
                }
                _ => {}
            }
        }
        items.reverse();
        frames.push((tid, items));
        Ok(())
    };

    push_tree(repo, tree_id, base.to_string(), &mut frames, &mut active_trees)?;
    while let Some((tid, items)) = frames.last_mut() {
        let Some(item) = items.pop() else {
            let done_tid = *tid;
            frames.pop();
            active_trees.remove(&done_tid);
            continue;
        };
        match item {
            EitherEntry::Blob(entry) => out.push(entry),
            EitherEntry::Tree(child_id, child_rel) => {
                push_tree(repo, child_id, child_rel, &mut frames, &mut active_trees)?;
            }
        }
    }
    Ok(())
}

enum EitherEntry {
    Blob(NativeTreeEntry),
    Tree(gix::hash::ObjectId, String),
}

#[napi(object)]
pub struct NativeHeadInfo {
    pub ref_name: String,
    pub commit: Option<String>,
}

fn resolve_head_sync(repo: &gix::Repository) -> Result<NativeHeadInfo> {
    let head = repo
        .head()
        .map_err(|e| git_err("INVALID_REF", format!("cannot read HEAD: {e}")))?;
    let Some(referent) = head.referent_name() else {
        return Err(git_err(
            "INVALID_REF",
            format!("{} has a detached HEAD", repo.git_dir().display()),
        ));
    };
    // Reject non-UTF-8 symbolic referents instead of looking up a lossy U+FFFD spelling (Major #15).
    let ref_name = std::str::from_utf8(referent.as_bstr().as_ref())
        .map_err(|_| git_err("INVALID_REF", "HEAD symbolic referent is not valid UTF-8"))?
        .to_owned();
    if head.is_unborn() {
        return Ok(NativeHeadInfo {
            ref_name,
            commit: None,
        });
    }
    let mut mutable = repo
        .find_reference(ref_name.as_str())
        .map_err(|e| git_err("INVALID_REF", format!("cannot resolve {ref_name}: {e}")))?;
    let id = mutable
        .peel_to_id()
        .map_err(|e| git_err("INVALID_REF", format!("{ref_name} is not a valid commit id: {e}")))?
        .detach();
    let _commit = repo.find_commit(id).map_err(|e| {
        git_err(
            "INVALID_REF",
            format!("{ref_name} ({id}) does not resolve to a commit object: {e}"),
        )
    })?;
    Ok(NativeHeadInfo {
        ref_name,
        commit: Some(id.to_string()),
    })
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
        let committer_sig = decoded
            .committer()
            .map_err(|e| git_err("REPO_CORRUPT", format!("commit {curr_oid} committer invalid: {e}")))?;
        let committer_time = committer_sig
            .time()
            .map_err(|e| git_err("REPO_CORRUPT", format!("commit {curr_oid} committer time invalid: {e}")))?
            .seconds;
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

struct ExtractLockGuard {
    lock_path: std::path::PathBuf,
}
impl Drop for ExtractLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock_path);
    }
}

fn extract_lock_path_for(dest: &Path) -> Result<std::path::PathBuf> {
    let canonical = fs::canonicalize(dest)
        .map_err(|e| git_err("IO_ERROR", format!("cannot canonicalize {}: {e}", dest.display())))?;
    #[allow(unused_mut)]
    let mut key_str = canonical.to_string_lossy().into_owned();
    #[cfg(any(windows, target_os = "macos"))]
    {
        key_str = key_str.to_lowercase();
    }
    let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha1);
    hasher.update(key_str.as_bytes());
    let digest = hasher
        .try_finalize()
        .map_err(|e| git_err("IO_ERROR", format!("cannot hash lock key: {e}")))?
        .to_string();
    let mut lock_dir = std::env::temp_dir();
    #[cfg(unix)]
    {
        let uid = unsafe { libc::geteuid() };
        lock_dir.push(format!("penguin-extract-locks-{uid}"));
    }
    #[cfg(not(unix))]
    {
        lock_dir.push("penguin-extract-locks");
    }
    fs::create_dir_all(&lock_dir)
        .map_err(|e| git_err("IO_ERROR", format!("cannot create lock dir {}: {e}", lock_dir.display())))?;
    Ok(lock_dir.join(format!("{digest}.lock")))
}

fn extract_tree_sync(
    repo: &gix::Repository,
    commit_oid: &str,
    prefix: &str,
    dest_dir: &str,
    only_paths: Option<&[String]>,
) -> Result<NativeExtractResult> {
    let commit_id = oid_of(commit_oid).map_err(|e| git_err("INVALID_OID", e.reason))?;
    if !prefix.is_empty() && !is_safe_rel_path(prefix) {
        return Err(git_err("INVALID_PATH", format!("unsafe prefix: {prefix}")));
    }
    let only_set: Option<HashSet<&str>> = match only_paths {
        Some(paths) => {
            let mut s = HashSet::with_capacity(paths.len());
            for p in paths {
                if !is_safe_rel_path(p) {
                    return Err(git_err("INVALID_PATH", format!("unsafe onlyPath: {p}")));
                }
                s.insert(p.as_str());
            }
            Some(s)
        }
        None => None,
    };

    let dest = Path::new(dest_dir);
    match fs::symlink_metadata(dest) {
        Ok(meta) => {
            if !meta.file_type().is_dir() {
                return Err(git_err(
                    "DEST_NOT_EMPTY",
                    format!("{dest_dir} exists and is not a real directory"),
                ));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(dest)
                .map_err(|e| git_err("IO_ERROR", format!("cannot create {dest_dir}: {e}")))?;
        }
        Err(e) => {
            return Err(git_err("IO_ERROR", format!("cannot lstat {dest_dir}: {e}")));
        }
    }

    // Reserve destination outside the extracted namespace so tracked files named
    // `.penguin-extract.lock` never collide with extraction's own lock (Major #14).
    let lock_path = extract_lock_path_for(dest)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                git_err("DEST_NOT_EMPTY", format!("{dest_dir} is currently locked or not empty"))
            } else {
                git_err("IO_ERROR", format!("cannot lock {dest_dir}: {e}"))
            }
        })?;
    let _lock_guard = ExtractLockGuard { lock_path };

    let mut rd = fs::read_dir(dest)
        .map_err(|e| git_err("IO_ERROR", format!("cannot read {dest_dir}: {e}")))?;
    if rd.next().is_some() {
        return Err(git_err("DEST_NOT_EMPTY", format!("{dest_dir} is not empty")));
    }

    let Some(tree_id) = subtree_oid(repo, commit_id, prefix)? else {
        return Ok(NativeExtractResult {
            files: Vec::new(),
            total_bytes: 0.0,
        });
    };

    let mut entries = Vec::new();
    collect_tree_entries(repo, tree_id, "", false, &mut entries)?;

    let selected: Vec<NativeTreeEntry> = match only_set {
        Some(ref set) => entries
            .into_iter()
            .filter(|e| set.contains(e.rel.as_str()))
            .collect(),
        None => entries,
    };

    // Preflight all selected paths against destination platform constraints BEFORE writing (Minor #5).
    for entry in &selected {
        if !is_safe_rel_path(&entry.rel) || !is_win32_extractable_path(&entry.rel) {
            return Err(git_err(
                "INVALID_PATH",
                format!("tree entry has unsafe or unextractable path: {}", entry.rel),
            ));
        }
    }

    let mut files = Vec::new();
    let mut total_bytes: u64 = 0;
    // Track exact relative directory spellings created in this run so case-insensitive FS merges fail loudly.
    let mut created_dirs: HashSet<String> = HashSet::new();

    for entry in selected {
        let blob_id = oid_of(&entry.oid).map_err(|e| git_err("REPO_CORRUPT", e.reason))?;
        let obj = repo
            .find_object(blob_id)
            .map_err(|e| git_err("REPO_CORRUPT", format!("blob {blob_id} missing: {e}")))?;
        if obj.kind != gix::object::Kind::Blob {
            return Err(git_err(
                "REPO_CORRUPT",
                format!(
                    "tree entry {} points to {:?}, expected blob",
                    entry.rel, obj.kind
                ),
            ));
        }

        // Create parent directories one component at a time without silently merging case-colliding spellings.
        let parts: Vec<&str> = entry.rel.split('/').collect();
        let mut cur_dir = dest.to_path_buf();
        let mut cur_rel = String::new();
        for dir_part in &parts[..parts.len() - 1] {
            if !cur_rel.is_empty() {
                cur_rel.push('/');
            }
            cur_rel.push_str(dir_part);
            cur_dir.push(dir_part);
            if !created_dirs.contains(&cur_rel) {
                fs::create_dir(&cur_dir).map_err(|e| {
                    if e.kind() == io::ErrorKind::AlreadyExists {
                        git_err(
                            "INVALID_PATH",
                            format!("directory case or path collision at {cur_rel}"),
                        )
                    } else {
                        git_err("IO_ERROR", format!("cannot create directory {cur_rel}: {e}"))
                    }
                })?;
                created_dirs.insert(cur_rel.clone());
            }
        }

        let target = cur_dir.join(parts[parts.len() - 1]);
        let mut open_opts = fs::OpenOptions::new();
        open_opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_opts.mode(if entry.mode == "100755" { 0o777 } else { 0o666 });
        }
        let mut f = open_opts.open(&target).map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                git_err(
                    "INVALID_PATH",
                    format!("file case or path collision at {}", entry.rel),
                )
            } else {
                git_err("IO_ERROR", format!("cannot create {}: {e}", target.display()))
            }
        })?;
        f.write_all(&obj.data)
            .map_err(|e| git_err("IO_ERROR", format!("cannot write {}: {e}", target.display())))?;
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
    pub body: Option<SafeBytes>,
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

fn validate_identity_field(value: &str, field: &str) -> Result<()> {
    if value.is_empty()
        || value
            .bytes()
            .any(|b| b == 0 || b == b'\n' || b == b'\r' || b == b'<' || b == b'>')
    {
        return Err(git_err(
            "INVALID_PATH",
            format!("invalid identity {field}: must be non-empty and free of NUL/CR/LF/< / >"),
        ));
    }
    Ok(())
}

fn signature_of(identity: &IdentityInput) -> Result<gix::actor::Signature> {
    validate_identity_field(&identity.name, "name")?;
    validate_identity_field(&identity.email, "email")?;
    if !identity.when_seconds.is_finite() || identity.when_seconds < 0.0 {
        return Err(git_err(
            "INVALID_PATH",
            format!("invalid commit timestamp: {}", identity.when_seconds),
        ));
    }
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

struct OwnedRepoCommitFileInput {
    rel: String,
    file_path: Option<String>,
    body: Option<Vec<u8>>,
    mode: Option<String>,
}

struct OwnedRepoCommitInput {
    parent: Option<String>,
    prefix: String,
    change_kind: String,
    files: Option<Vec<OwnedRepoCommitFileInput>>,
    remove: Option<Vec<String>>,
    message: String,
    author: IdentityInput,
    committer: IdentityInput,
}

impl From<RepoCommitInput> for OwnedRepoCommitInput {
    fn from(v: RepoCommitInput) -> Self {
        OwnedRepoCommitInput {
            parent: v.parent,
            prefix: v.prefix,
            change_kind: v.change_kind,
            files: v.files.map(|list| {
                list.into_iter()
                    .map(|f| OwnedRepoCommitFileInput {
                        rel: f.rel,
                        file_path: f.file_path,
                        // Copy JS-backed Buffer synchronously on the JS thread to avoid UB.
                        body: f.body.map(|b| b.0),
                        mode: f.mode,
                    })
                    .collect()
            }),
            remove: v.remove,
            message: v.message,
            author: v.author,
            committer: v.committer,
        }
    }
}

fn prepare_commit_sync(
    repo: &gix::Repository,
    input: &OwnedRepoCommitInput,
) -> Result<NativePreparedCommit> {
    if !input.prefix.is_empty() && !is_safe_rel_path(&input.prefix) {
        return Err(git_err(
            "INVALID_PATH",
            format!("unsafe prefix: {}", input.prefix),
        ));
    }
    // Contract reserves branch creation strictly for null/None; empty string is INVALID_OID (Minor #6).
    let parent = match input.parent.as_deref() {
        Some(hex) => Some(oid_of(hex).map_err(|e| git_err("INVALID_OID", e.reason))?),
        None => None,
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

    // Reject scoped edits that would silently evict a tracked file ancestor outside `prefix` (Major #13).
    let writing_under_prefix = match input.change_kind.as_str() {
        "replace" => input.files.as_ref().map_or(false, |xs| !xs.is_empty()),
        "patch" => input.files.as_ref().map_or(false, |xs| !xs.is_empty()),
        _ => false,
    };
    if parent.is_some() && !input.prefix.is_empty() && writing_under_prefix {
        let segs: Vec<&str> = input.prefix.split('/').collect();
        let check_len = if input.change_kind == "patch" {
            segs.len()
        } else {
            segs.len().saturating_sub(1)
        };
        let mut cur_tree_id = parent_tree;
        let mut anc_path = String::new();
        for seg in &segs[..check_len] {
            if !anc_path.is_empty() {
                anc_path.push('/');
            }
            anc_path.push_str(seg);
            let tree = repo
                .find_tree(cur_tree_id)
                .map_err(|e| git_err("REPO_CORRUPT", format!("tree {cur_tree_id} missing: {e}")))?;
            let decoded = tree
                .decode()
                .map_err(|e| git_err("REPO_CORRUPT", format!("tree {cur_tree_id} malformed: {e}")))?;
            let mut next_tree = None;
            for entry in decoded.entries {
                if entry.filename == seg.as_bytes() {
                    if entry.mode.is_tree() {
                        next_tree = Some(entry.oid.to_owned());
                    } else {
                        return Err(git_err(
                            "INVALID_PATH",
                            format!("scoped edit under {} conflicts with tracked file at {anc_path}", input.prefix),
                        ));
                    }
                    break;
                }
            }
            match next_tree {
                Some(tid) => cur_tree_id = tid,
                None => break,
            }
        }
    }

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
                            .write_blob(buf.as_slice())
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
                            .write_blob(buf.as_slice())
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

fn has_non_conflict_io_error(err: &(dyn std::error::Error + 'static)) -> bool {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = cur {
        if let Some(io_err) = e.downcast_ref::<io::Error>() {
            if io_err.kind() != io::ErrorKind::AlreadyExists {
                return true;
            }
        }
        cur = e.source();
    }
    let msg = err.to_string();
    msg.contains("Permission denied")
        || msg.contains("Read-only file system")
        || msg.contains("No space left on device")
        || msg.contains("Input/output error")
        || msg.contains("Too many open files")
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

    match expected_parent {
        Some(hex) => {
            let old_id = oid_of(hex).map_err(|e| git_err("INVALID_OID", e.reason))?;
            let edit = RefEdit::update(
                full_name,
                new_id,
                PreviousValue::MustExistAndMatch(Target::Object(old_id)),
                "",
            );
            repo.edit_reference(edit).map_err(|e| {
                if has_non_conflict_io_error(&e) {
                    git_err("IO_ERROR", format!("ref storage error for {ref_name}: {e}"))
                } else {
                    git_err("CAS_CONFLICT", format!("ref update refused for {ref_name}: {e}"))
                }
            })?;
            Ok(())
        }
        _ => {
            // Strict creation CAS: gix-ref 0.70.0 `PreviousValue::MustNotExist` treats an existing
            // ref equal to `new_id` as a no-op success instead of conflict. Acquire Git's `.lock`
            // file directly, verify strict absence AND D/F namespace non-conflict across BOTH
            // loose and packed refs under lock, then publish atomically.
            let ref_rel = full_name.as_bstr().to_string();
            let ref_path = repo.git_dir().join(&ref_rel);
            if let Some(parent) = ref_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    if e.kind() == io::ErrorKind::AlreadyExists || e.kind() == io::ErrorKind::NotADirectory {
                        git_err("CAS_CONFLICT", format!("ref namespace conflict for {ref_name}: {e}"))
                    } else {
                        git_err("IO_ERROR", format!("cannot create ref parent {}: {e}", parent.display()))
                    }
                })?;
            }
            let lock_path = repo.git_dir().join(format!("{ref_rel}.lock"));
            let mut lock_file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
                .map_err(|e| {
                    if e.kind() == io::ErrorKind::AlreadyExists {
                        git_err("CAS_CONFLICT", format!("ref {ref_name} is locked"))
                    } else {
                        git_err("IO_ERROR", format!("cannot lock {ref_name}: {e}"))
                    }
                })?;
            let result = (|| -> Result<()> {
                let existing = repo.try_find_reference(full_name.as_bstr()).map_err(|e| {
                    git_err("INVALID_REF", format!("cannot inspect {ref_name}: {e}"))
                })?;
                if existing.is_some() {
                    return Err(git_err(
                        "CAS_CONFLICT",
                        format!("ref {ref_name} already exists (expected absent)"),
                    ));
                }
                // Check loose + packed refs for D/F conflicts (`refs/heads/topic` vs `refs/heads/topic/sub`).
                let ref_slash = format!("{ref_rel}/");
                let refs_platform = repo.references().map_err(|e| {
                    git_err("IO_ERROR", format!("cannot iterate refs for {ref_name}: {e}"))
                })?;
                let iter = refs_platform.all().map_err(|e| {
                    git_err("IO_ERROR", format!("cannot list refs for {ref_name}: {e}"))
                })?;
                for item in iter {
                    let r = item.map_err(|e| {
                        git_err("IO_ERROR", format!("cannot read ref entry while locking {ref_name}: {e}"))
                    })?;
                    let other = r.name().as_bstr().to_string();
                    if other == ref_rel
                        || other.starts_with(&ref_slash)
                        || ref_rel.starts_with(&format!("{other}/"))
                    {
                        return Err(git_err(
                            "CAS_CONFLICT",
                            format!("ref {ref_name} conflicts with existing ref {other}"),
                        ));
                    }
                }
                lock_file
                    .write_all(format!("{new_id}\n").as_bytes())
                    .map_err(|e| git_err("IO_ERROR", format!("cannot write lock for {ref_name}: {e}")))?;
                drop(lock_file);
                fs::rename(&lock_path, &ref_path)
                    .map_err(|e| git_err("IO_ERROR", format!("cannot publish {ref_name}: {e}")))?;
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_file(&lock_path);
            }
            result
        }
    }
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
        let repo = gix::open_opts(&self.gitdir, gix::open::Options::isolated())
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
    input: OwnedRepoCommitInput,
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
            input: input.into(),
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
    pub body: SafeBytes,
}

struct OwnedFileEntry {
    rel: String,
    body: Vec<u8>,
}

struct OwnedCommitInput {
    gitdir: String,
    ref_name: String,
    parent: Option<String>,
    rel: String,
    files: Option<Vec<OwnedFileEntry>>,
    message: String,
    author: IdentityInput,
    committer: IdentityInput,
}

impl From<CommitInput> for OwnedCommitInput {
    fn from(v: CommitInput) -> Self {
        OwnedCommitInput {
            gitdir: v.gitdir,
            ref_name: v.ref_name,
            parent: v.parent,
            rel: v.rel,
            files: v.files.map(|xs| {
                xs.into_iter()
                    .map(|f| OwnedFileEntry {
                        rel: f.rel,
                        body: f.body.0,
                    })
                    .collect()
            }),
            message: v.message,
            author: v.author,
            committer: v.committer,
        }
    }
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

fn commit_sync(input: &OwnedCommitInput) -> Result<String> {
    let repo = gix::open_opts(&input.gitdir, gix::open::Options::isolated())
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
                    .write_blob(file.body.as_slice())
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
    input: OwnedCommitInput,
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
    AsyncTask::new(CommitTask { input: input.into() })
}

fn read_objects_sync(gitdir: &str, oids: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
    let repo = gix::open_opts(gitdir, gix::open::Options::isolated())
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
