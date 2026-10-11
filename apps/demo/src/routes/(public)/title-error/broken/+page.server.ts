import { error } from "bosia";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	error(404, "No such thing");
};
