import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
        <GraduationCap className="size-6 text-primary" aria-hidden /> LinguaPractice
      </Link>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && <div className="text-sm text-muted-foreground">{footer}</div>}
    </main>
  );
}
