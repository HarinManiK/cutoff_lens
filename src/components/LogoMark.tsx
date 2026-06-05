import Image from "next/image";

type LogoMarkProps = {
  className?: string;
};

export function LogoMark({ className = "" }: LogoMarkProps) {
  return (
    <span className={["logo-mark", className].filter(Boolean).join(" ")} aria-hidden="true">
      <Image src="/logo.svg" alt="" width={96} height={96} />
    </span>
  );
}
