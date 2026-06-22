# Clickable banners

- `banners.link_type` controls click behavior.
- `banners.link_value` stores the destination.
- Valid types: `none`, `product`, `category`, `promotions`, `post`, `external`.
- Old banners default to `none` and remain ordinary non-clickable images.
- The mobile app opens a product, category, promotions page, post, or external link based on `link_type`.
- Product destinations use a product ID.
- Category destinations use the category name supported by the catalog; an ID is used only when it can be resolved from catalog data.
- Post destinations use a post ID and open the existing blog detail screen.
- External links must use `http://` or `https://`; the backend adds `https://` when the protocol is omitted.
- Unknown or invalid destinations do nothing in the mobile app.
- A backend restart is required after deployment so the idempotent database migration adds the new columns.
- An EAS Update is required for the mobile JavaScript changes.
- A new Android binary build is not required.
