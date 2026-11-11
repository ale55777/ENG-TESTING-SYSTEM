import { Suspense } from "react";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
