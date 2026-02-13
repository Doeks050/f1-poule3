import { Suspense } from "react";
import JoinClient from "./JoinClient";

export default function JoinPage() {
  return (
    <Suspense fallback={<main style={{ padding: 16 }}>Loading…</main>}>
      <JoinClient />
    </Suspense>
  );
}
