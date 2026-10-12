import { redirect } from "next/navigation";

// Boards is the home page; the campaign list lives at /campaigns.
export default function Home() {
  redirect("/boards");
}
