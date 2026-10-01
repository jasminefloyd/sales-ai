export type AudienceHierarchyItem = {
  icp_id: string | null;
  icp_version: number;
  audience_version: number;
};

export function groupAudiencesByIcp<T extends AudienceHierarchyItem>(audiences: T[]) {
  return audiences.reduce<Record<string, T[]>>((groups, audience) => {
    const key = audience.icp_id ?? 'unassigned';
    (groups[key] ??= []).push(audience);
    return groups;
  }, {});
}

export function partitionAudiencesByIcp<T extends AudienceHierarchyItem>(
  audiences: T[],
  icpIds: Iterable<string>,
) {
  const knownIcpIds = new Set(icpIds);
  const grouped = groupAudiencesByIcp(
    audiences.filter(
      (audience) => audience.icp_id === null || knownIcpIds.has(audience.icp_id),
    ),
  );
  const ungrouped = audiences.filter(
    (audience) => audience.icp_id !== null && !knownIcpIds.has(audience.icp_id),
  );
  if (ungrouped.length > 0)
    grouped.unassigned = [...(grouped.unassigned ?? []), ...ungrouped];
  return { grouped, ungrouped };
}
