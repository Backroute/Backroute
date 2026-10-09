import { redirect } from "next/navigation";

/** The link at the end of the owner's evening text ("Details: backroute.pro/today"): their dashboard's today view. */
export default function Today() {
  redirect("/carrier");
}
