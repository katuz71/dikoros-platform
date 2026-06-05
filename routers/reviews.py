"""Review routes."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from db import get_db_connection
from models.schemas import ReviewCreate
from services.users import normalize_phone
from services.auth import get_current_user_phone


router = APIRouter()


@router.get("/api/reviews/{product_id}")
def get_product_reviews(product_id: int):
    """Return all reviews for one product with aggregated rating metadata."""
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT * FROM reviews
        WHERE product_id=?
        ORDER BY created_at DESC
        """,
        (product_id,),
    ).fetchall()
    conn.close()

    reviews = [dict(row) for row in rows]
    if reviews:
        avg_rating = sum(review["rating"] for review in reviews) / len(reviews)
        return {
            "reviews": reviews,
            "average_rating": round(avg_rating, 1),
            "total_count": len(reviews),
        }

    return {"reviews": [], "average_rating": 0, "total_count": 0}


@router.post("/api/reviews")
async def create_review(review: ReviewCreate, phone: str = Depends(get_current_user_phone)):
    """Create a review for authenticated user only."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=401, detail="Invalid authorization")

    conn = get_db_connection()
    cur = conn.cursor()

    existing = cur.execute(
        """
        SELECT id FROM reviews
        WHERE product_id=? AND user_phone=?
        """,
        (review.product_id, clean_phone),
    ).fetchone()

    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="Ви вже залишили відгук на цей товар")

    row = cur.execute(
        """
        INSERT INTO reviews (product_id, user_name, user_phone, rating, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (
            review.product_id,
            review.user_name,
            clean_phone,
            review.rating,
            review.comment,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        ),
    ).fetchone()
    review_id = (row or {}).get("id")
    conn.commit()
    conn.close()

    return {
        "status": "ok",
        "review_id": review_id,
        "message": "Дякуємо за ваш відгук!",
    }


@router.delete("/api/reviews/{id}")
async def delete_review(id: int, phone: str = Depends(get_current_user_phone)):
    """Delete own review only."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=401, detail="Invalid authorization")

    conn = get_db_connection()
    try:
        row = conn.execute("SELECT user_phone FROM reviews WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Review not found")

        owner_phone = normalize_phone(dict(row).get("user_phone") or "")
        if owner_phone != clean_phone:
            raise HTTPException(status_code=403, detail="Forbidden")

        conn.execute("DELETE FROM reviews WHERE id=?", (id,))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()



@router.get("/api/user/reviews/me")
def get_current_user_reviews(phone: str = Depends(get_current_user_phone)):
    clean_phone = normalize_phone(phone)
    return _get_user_reviews_by_phone(clean_phone)


@router.get("/api/user/reviews/{phone}")
def get_user_reviews_legacy(phone: str):
    raise HTTPException(
        status_code=410,
        detail="Legacy user reviews endpoint is disabled. Use /api/user/reviews/me with authorization."
    )


def _get_user_reviews_by_phone(phone: str):
    """Return all reviews by user phone."""
    clean_phone = normalize_phone(phone)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT r.*, p.name as product_name, p.image as product_image
        FROM reviews r
        LEFT JOIN products p ON r.product_id = p.id
        WHERE r.user_phone=?
        ORDER BY r.created_at DESC
        """,
        (clean_phone,),
    ).fetchall()
    conn.close()

    return [dict(row) for row in rows]
