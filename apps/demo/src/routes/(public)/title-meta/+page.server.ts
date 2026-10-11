import type { PageMetadataLoad } from "./$types";

export const metadata: PageMetadataLoad = ({ url }) =>
	url.searchParams.has("quiet") ? {} : { title: "Named by metadata" };
