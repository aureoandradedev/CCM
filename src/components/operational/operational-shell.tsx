"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, User } from "lucide-react";

import { signOut } from "@/app/conta/actions";

interface OperationalShellProps {
  area: string;
  areaIcon: React.ReactNode;
  userName: string;
  children: React.ReactNode;
}

export function OperationalShell({ area, areaIcon, userName, children }: OperationalShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <header className="sticky top-0 z-30 bg-brand-navy text-white shadow-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 lg:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/mascote-head.png" alt="" width={32} height={32} className="size-8 rounded-full bg-white/90" />
            <div className="hidden h-6 w-px bg-white/20 sm:block" />
            <div className="flex items-center gap-1.5 text-white/90">
              {areaIcon}
              <span className="font-heading text-sm font-bold tracking-wide">{area}</span>
            </div>
          </div>

          <div className="flex-1" />

          <Link
            href="/conta"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <User className="size-3.5" />
            <span className="hidden sm:inline">{userName}</span>
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex size-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Sair"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
    </div>
  );
}
