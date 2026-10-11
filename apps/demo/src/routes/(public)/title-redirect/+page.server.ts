import { redirect } from "bosia";
import type { PageServerLoad } from "./$types";

// Sits outside /title-seo, so the redirect back must not count as leaving it.
export const load: PageServerLoad = () => {
	redirect(303, "/title-seo");
};
