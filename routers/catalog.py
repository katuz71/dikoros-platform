from fastapi import APIRouter
from db import get_db_connection
from services.products import normalize_product_row

router = APIRouter(prefix='/api/catalog', tags=['catalog'])


def _products(where='', params=()):
    conn = get_db_connection()
    rows = conn.execute('SELECT * FROM products ' + where + ' ORDER BY COALESCE(sort_order, id), id LIMIT 500', params).fetchall()
