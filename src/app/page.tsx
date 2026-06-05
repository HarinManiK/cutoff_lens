import { ExamCard } from "@/components/ExamCard";
import { LogoMark } from "@/components/LogoMark";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="landing-title-row">
            <LogoMark className="logo-mark--landing" />
            <h1 className="page-title">Cutoff Lens</h1>
          </div>
          <p className="page-kicker">Find which college and course you would get.</p>
        </div>
      </header>

      <section className="exam-grid" aria-label="Exams">
        <ExamCard href="/exams/jee-advanced" title="JEE Advanced" />
      </section>
    </main>
  );
}
