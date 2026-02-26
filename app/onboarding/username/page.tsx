import { Suspense } from "react";
import UsernameClient from "./UsernameClient";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>Loading...</div>}>
      <UsernameClient />
    </Suspense>
  );
}
