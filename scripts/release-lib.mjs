export const PACKAGE = "@sidhq/sid-sdk";
export function stableVersions(metadata, tags) {
  return [...new Set([...Object.keys(metadata.versions ?? {}), ...tags.map(tag => tag.replace(/^v/, ""))])]
    .filter(value => /^\d+\.\d+\.\d+$/.test(value))
    .sort((a, b) => {
      const left = a.split(".").map(Number), right = b.split(".").map(Number);
      return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    });
}
export function selectVersion(metadata, tagRecords, sha) {
  const own = tagRecords.filter(tag => tag.sha === sha && /^v\d+\.\d+\.\d+$/.test(tag.name));
  if (own.length > 1) throw new Error("Multiple release reservations for one source SHA");
  if (own.length) return own[0].name.slice(1);
  const published = Object.entries(metadata.versions ?? {}).filter(([, pkg]) => pkg.sidSourceCommit === sha);
  if (published.length > 1) throw new Error("Multiple published versions for one source SHA");
  if (published.length) return published[0][0];
  const latest = stableVersions(metadata, tagRecords.map(tag => tag.name)).at(-1);
  if (!latest) return "0.1.0";
  const [major, minor, patch] = latest.split(".").map(Number);
  if (![major, minor, patch + 1].every(Number.isSafeInteger)) throw new Error("Version exceeds safe integer range");
  return `${major}.${minor}.${patch + 1}`;
}
export function publicationState(metadata, version, sha) {
  const pkg = metadata.versions?.[version];
  if (!pkg) return "unpublished";
  if (pkg.sidSourceCommit !== sha) throw new Error(`Version ${version} belongs to another source SHA`);
  return "published";
}
export function releaseTag(latestSha, sha, isAncestor) {
  if (!latestSha || latestSha === sha || isAncestor(latestSha, sha)) return "latest";
  if (isAncestor(sha, latestSha)) return `revision-${sha}`;
  throw new Error("Latest npm release and this revision have unrelated Git history");
}
