import { Database } from "lucide-react";
import { ExamCard } from "@/components/ExamCard";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <span className="brand-mark" aria-hidden="true">
            <Database size={19} />
          </span>
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
