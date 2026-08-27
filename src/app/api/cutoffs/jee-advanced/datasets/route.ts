import { NextResponse } from "next/server";
import { listJeeAdvancedDatasets } from "@/lib/datasets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { datasets, source } = await listJeeAdvancedDatasets();
    return NextResponse.json({ datasets, meta: { source } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list datasets." },
      { status: 500 },
    );
  }
}
