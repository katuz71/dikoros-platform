"""Analytics API router."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks

from models.schemas import AnalyticsEventReq
from services.analytics import track_analytics_event


router = APIRouter(prefix="/api", tags=["analytics"])


@router.post("/track")
async def track_event_endpoint(evt: AnalyticsEventReq, background_tasks: BackgroundTasks):
    """Proxy endpoint for server-side analytics tracking."""
    background_tasks.add_task(track_analytics_event, evt.event_name, evt.properties, evt.user_data)
    return {"status": "ok"}
