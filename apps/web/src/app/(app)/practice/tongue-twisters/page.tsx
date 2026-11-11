import { Suspense } from "react";
import { ReadAloudPractice } from "@/components/practice/read-aloud-practice";

export const metadata = { title: "Tongue twisters" };

export default function TongueTwisterPage() {
  return (
    <Suspense>
      <ReadAloudPractice type="tongue_twister" />
    </Suspense>
  );
}
