//! The Agent State engine's native half: the two engine steps in-process, on gitoxide.
//!
//! A commit builds the tree in memory — `edit_tree` on the parent's tree (or the empty tree for
//! the branch's first commit) replaces the folder wholesale, `remove` then `upsert` per file,
//! exactly the semantics `git add -A` gives a working tree — writes the blobs, and writes the
//! commit with `commit_as`, whose reference update is the CAS the harness asks for: the first
//! parent must be the reference's current target, and a first commit refuses a reference that
//! already exists. Reading a version back is `find_object` per id, the in-process shape of
//! `git cat-file --batch`.
//!
//! Every step writes the same bytes as the real-Git engines: files `100644`, trees in git's
//! order, the message whole, both identity lines from the harness's zone — so the same input is
//! the same commit under either, and the interchange tests pin that.
use std::path::PathBuf;

use napi::bindgen_prelude::Buffer;
use napi::{Error, Result, Status};
use napi_derive::napi;

/// git's zone lives in the commit as `+hhmm`; the harness hands the offset in minutes.
fn signature_of(identity: &IdentityInput) -> gix_object::Signature {
    gix_object::Signature {
        name: identity.name.as_bytes().into(),
        email: identity.email.as_bytes().into(),
        time: gix_date::Time {
            seconds: identity.when_seconds as i64,
            offset: (identity.when_offset_minutes as i64) * 60,
        },
    }
}

fn oid_of(hex: &str) -> Result<gix::hash::ObjectId> {
    gix::hash::ObjectId::from_hex(hex.as_bytes()).map_err(|e| {
        Error::new(
            Status::InvalidArg,
            format!("not a full hex object id: {hex} ({e})"),
        )
    })
}

fn refuse(message: String) -> Error {
    Error::new(Status::GenericFailure, message)
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
pub struct FileEntry {
    /// The file's path under the commit's folder, `/`-separated.
    pub rel: String,
    pub body: Buffer,
}

#[napi(object)]
pub struct CommitInput {
    /// The bare repository, absolute. It exists.
    pub gitdir: String,
    /// The branch the commit moves, `refs/heads/main`.
    pub ref_name: String,
    /// The branch's commit the new one is made on (full hex), or null for the branch's first.
    pub parent: Option<String>,
    /// The folder the commit replaces, `workbenches/<id>`.
    pub rel: String,
    /// The folder's files; null removes the folder.
    pub files: Option<Vec<FileEntry>>,
    /// The commit message, whole: it ends in a line break.
    pub message: String,
    pub author: IdentityInput,
    pub committer: IdentityInput,
}

/// Writes the commit's objects and moves the branch from `parent` to it; answers the commit id.
///
/// The branch moves only from the parent the commit names (a branch another writer moved
/// meanwhile refuses the write), and a branch's first commit refuses a branch that already
/// exists — the same refusal `git update-ref` and `git push` give.
#[napi]
pub fn commit(input: CommitInput) -> Result<String> {
    let repo = gix::open(&input.gitdir)
        .map_err(|e| refuse(format!("gitoxide cannot open {}: {e}", input.gitdir)))?;

    let parent = match input.parent.as_deref() {
        Some(hex) if !hex.is_empty() => Some(oid_of(hex)?),
        _ => None,
    };
    let foundation = match parent {
        Some(id) => repo
            .find_commit(id)
            .map_err(|e| refuse(format!("parent {hex} is not in the repository: {e}", hex = input.parent.as_deref().unwrap_or(""))))?
            .tree_id()?,
        None => gix::hash::ObjectId::empty_tree(repo.object_hash()),
    };

    let mut editor = repo
        .edit_tree(foundation)
        .map_err(|e| refuse(format!("gitoxide cannot edit the parent's tree: {e}")))?;
    match &input.files {
        // Null removes the folder: every file gone.
        None => {
            editor
                .remove(PathBuf::from(&input.rel))
                .map_err(|e| refuse(format!("cannot remove {}: {e}", input.rel)))?;
        }
        Some(files) => {
            // The folder's files replace what the folder had, so the folder goes first —
            // except on the branch's first commit, where there is nothing to remove.
            if parent.is_some() {
                editor
                    .remove(PathBuf::from(&input.rel))
                    .map_err(|e| refuse(format!("cannot replace {}: {e}", input.rel)))?;
            }
            for file in files {
                let blob = repo
                    .write_blob(file.body.as_ref())
                    .map_err(|e| refuse(format!("cannot write {}: {e}", file.rel)))?;
                editor
                    .upsert(
                        PathBuf::from(&input.rel).join(&file.rel),
                        gix_object::tree::EntryKind::Blob,
                        blob.detach(),
                    )
                    .map_err(|e| refuse(format!("cannot add {}: {e}", file.rel)))?;
            }
        }
    }
    let tree = editor
        .write()
        .map_err(|e| refuse(format!("cannot write the tree: {e}")))?;

    let parents: &[gix::hash::ObjectId] = parent.as_ref().map(std::slice::from_ref).unwrap_or(&[]);
    let id = repo
        .commit_as(
            signature_of(&input.committer),
            signature_of(&input.author),
            input.ref_name.as_str(),
            input.message.as_str(),
            tree,
            parents,
        )
        .map_err(|e| refuse(format!("gitoxide refused the write: {e}")))?;
    Ok(id.detach().to_string())
}

/// The bodies of these blobs (full hex ids), in the order asked; an id not in the repository,
/// or an id of another kind, refuses.
#[napi]
pub fn read_blobs(gitdir: String, oids: Vec<String>) -> Result<Vec<Buffer>> {
    let repo = gix::open(&gitdir)
        .map_err(|e| refuse(format!("gitoxide cannot open {gitdir}: {e}")))?;
    let mut out = Vec::with_capacity(oids.len());
    for hex in &oids {
        let id = oid_of(hex)?;
        let object = repo
            .find_object(id)
            .map_err(|_| refuse(format!("object {hex} is not in the repository")))?;
        if object.kind != gix_object::Kind::Blob {
            return Err(refuse(format!(
                "{hex} is a {}, not a blob",
                object.kind
            )));
        }
        out.push(Buffer::from(object.data.to_vec()));
    }
    Ok(out)
}

/// Who the native half runs as, for the engine's log line.
#[napi]
pub fn engine_version() -> String {
    format!("gitoxide {}", env!("GIX_VERSION"))
}
