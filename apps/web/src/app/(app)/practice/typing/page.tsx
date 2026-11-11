import { Suspense } from "react";
import { TypingPractice } from "@/components/practice/typing-practice";

export const metadata = { title: "Typing practice" };

export default function TypingPage() {
  return (
    <Suspense>
      <TypingPractice />
    </Suspense>
  );
}
