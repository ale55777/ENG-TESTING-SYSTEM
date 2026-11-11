import Link from "next/link";
import { ArrowRight, AudioLines, BarChart3, BookOpenText, GraduationCap, Keyboard, MessagesSquare, Mic2, ShieldCheck, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  { icon: BookOpenText, title: "Reading aloud", text: "Read AI-generated or curated passages and see every matched, missing, extra and substituted word." },
  { icon: Mic2, title: "Pronunciation", text: "Word-level acoustic scoring from your actual audio — kept separate from speech-to-text accuracy." },
  { icon: Wind, title: "Tongue twisters", text: "Easy to hard challenges targeting difficult English sounds. Clarity first, then speed." },
  { icon: MessagesSquare, title: "IELTS-style speaking", text: "Part 1–3 style questions with measured fluency plus AI feedback on grammar and vocabulary." },
  { icon: Keyboard, title: "Typing", text: "Practice mode with corrections, or a strict forward-only challenge with exact WPM and accuracy." },
  { icon: BarChart3, title: "Progress", text: "Real charts from your own results, personalised recommendations and PDF/JSON/TXT reports." },
];

export default function Landing() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <GraduationCap className="size-6 text-primary" aria-hidden /> LinguaPractice
        </Link>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </nav>
      </header>
      <main id="main" className="flex-1">
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
          <div className="mx-auto max-w-4xl px-4 pb-16 pt-14 text-center sm:px-6 sm:pt-24">
            <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-sm text-muted-foreground">
              <AudioLines className="size-4 text-primary" aria-hidden /> Speak, listen, type — and see exactly what to improve
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Practise English with feedback you can trust</h1>
            <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
              Read aloud, drill pronunciation, beat tongue twisters, rehearse IELTS-style speaking and improve your typing. Every score comes from a measurement,
              and every explanation tells you how it was produced.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/register">
                  Create a free account <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="features">
          <h2 id="features" className="sr-only">
            Features
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-md">
                <f.icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-start gap-3 rounded-2xl border bg-muted/40 p-5 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p>
              Honest by design: this is a practice platform, not an official test or certification. Speech-to-text accuracy and pronunciation are measured
              separately, AI never overwrites measured scores, and microphone audio is never stored. When enabled, speech is transcribed by GroqCloud, an
              external service.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">LinguaPractice — English learning and practice. Scores are practice estimates only.</footer>
    </div>
  );
}
