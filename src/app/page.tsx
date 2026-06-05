import { ExamCard } from "@/components/ExamCard";
import { LogoMark } from "@/components/LogoMark";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <LogoMark />
          <h1 className="page-title" style={{ marginTop: 14 }}>
            Cutoff Lens
          </h1>
          <p className="page-kicker">Find which college and course you would get.</p>
        </div>
      </header>

      <section className="exam-grid" aria-label="Exams">
        <ExamCard href="/exams/jee-advanced" title="JEE Advanced" />
      </section>
    </main>
  );
}
