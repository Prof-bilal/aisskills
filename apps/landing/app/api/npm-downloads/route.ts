import { NextResponse } from "next/server";

const packageName = "@prof-bilal/aiskills";
const version = "0.2.0-beta.2";
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
const downloadsUrl = "https://api.npmjs.org/downloads/point";
const windowMonths = 17;

type RegistryMetadata = {
  time?: Record<string, string>;
};

type DownloadPoint = {
  downloads?: number;
  start?: string;
  end?: string;
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextWindowEnd(start: Date, end: Date) {
  const windowEnd = new Date(start);
  windowEnd.setUTCMonth(windowEnd.getUTCMonth() + windowMonths);
  windowEnd.setUTCDate(windowEnd.getUTCDate() - 1);
  return windowEnd < end ? windowEnd : end;
}

export async function GET() {
  try {
    const metadataResponse = await fetch(registryUrl, {
      next: { revalidate: 3600 },
    });

    if (!metadataResponse.ok) {
      throw new Error(`npm registry returned ${metadataResponse.status}`);
    }

    const metadata = (await metadataResponse.json()) as RegistryMetadata;
    // Start at the package's first publish date so the total includes every
    // public version, not only the current beta release.
    const publishedAt = metadata.time?.created ?? metadata.time?.[version];

    if (!publishedAt) {
      throw new Error("Package publish date was not found");
    }

    const start = new Date(publishedAt);
    const end = new Date();
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    let downloads = 0;

    while (cursor <= end) {
      const rangeEnd = nextWindowEnd(cursor, end);
      const pointUrl = `${downloadsUrl}/${dateOnly(cursor)}:${dateOnly(rangeEnd)}/${encodeURIComponent(packageName)}`;
      const pointResponse = await fetch(pointUrl, { next: { revalidate: 3600 } });

      if (!pointResponse.ok) {
        throw new Error(`npm downloads API returned ${pointResponse.status}`);
      }

      const point = (await pointResponse.json()) as DownloadPoint;
      downloads += point.downloads ?? 0;
      cursor = new Date(rangeEnd);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return NextResponse.json(
      { downloads, package: packageName, start: dateOnly(start), end: dateOnly(end) },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "npm download count unavailable" }, { status: 503 });
  }
}
