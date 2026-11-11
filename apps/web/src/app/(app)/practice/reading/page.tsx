import { Suspense } from "react";
import { ReadAloudPractice } from "@/components/practice/read-aloud-practice";

export const metadata = { title: "Reading aloud" };

export default function ReadingPage() {
  return (
    <Suspense>
      <ReadAloudPractice type="reading" />
    </Suspense>
  );
}
