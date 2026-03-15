import { NextRequest, NextResponse } from "next/server";

const WINDY_API_KEY = process.env.WINDY_API_KEY;
const BASE_URL = "https://api.windy.com/webcams/api/v3/webcams";

export async function GET(req: NextRequest) {
  if (!WINDY_API_KEY) {
    return NextResponse.json(
      { error: "WINDY_API_KEY not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = req.nextUrl;
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radius = searchParams.get("radius") || "50"; // km
  const limit = searchParams.get("limit") || "10";
  const category = searchParams.get("category"); // windy categories: beach, city, landscape, etc.

  // Build query params
  const params = new URLSearchParams({
    limit,
    offset: "0",
    include: "player,images,location",
  });

  // Geo filter
  if (lat && lng) {
    params.set("nearby", `${lat},${lng},${radius}`);
  }

  // Category filter
  if (category) {
    params.set("categories", category);
  }

  try {
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        "x-windy-api-key": WINDY_API_KEY,
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Windy API error: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch from Windy API" },
      { status: 500 }
    );
  }
}
