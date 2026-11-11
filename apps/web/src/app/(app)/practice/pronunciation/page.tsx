import { Suspense } from "react";
import { PronunciationPractice } from "@/components/practice/pronunciation-practice";

export const metadata = { title: "Pronunciation" };

export default function PronunciationPage() {
  return (
    <Suspense>
      <PronunciationPractice />
    </Suspense>
  );
}
