"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";

function Hint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-hint ${pending ? "is-pending" : ""}`} />;
}

export default function NavLink({
  href, children, className,
}: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center transition active:opacity-60 ${className ?? ""}`}>
      {children}
      <Hint />
    </Link>
  );
}
