import Link from "next/link";
import { ArrowRight } from "lucide-react";

type ExamCardProps = {
  href: string;
  title: string;
};

export function ExamCard({ href, title }: ExamCardProps) {
  return (
    <Link className="exam-card" href={href}>
      <div className="exam-card__top">
        <h2>{title}</h2>
        <ArrowRight aria-hidden="true" size={22} />
      </div>
    </Link>
  );
}
