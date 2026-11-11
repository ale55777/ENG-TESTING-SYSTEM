import { Suspense } from "react";
import { SpeakingPractice } from "@/components/practice/speaking-practice";

export const metadata = { title: "Speaking practice" };

export default function SpeakingPage() {
  return (
    <Suspense>
      <SpeakingPractice />
    </Suspense>
  );
}
