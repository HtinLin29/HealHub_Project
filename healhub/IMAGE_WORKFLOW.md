# HealHub Image Workflow

## Recommended product image flow

1. Prefer uploading real product packshots to the `product-images` Supabase Storage bucket.
2. Each uploaded file is stored as:
   - `products/<productId>.<ext>`
3. After upload, save the returned public URL into `products.image_url`.
4. If you manually paste an image URL, use a full public `http://` or `https://` URL only.
5. Placeholder images should be treated as temporary fallback only.

## Current app behavior

- Storefront and inventory both use the same image resolver.
- If a product has a valid public image URL, it is shown.
- If not, the app falls back to a generated placeholder image.
- Inventory previews the current image so owners can spot bad URLs quickly.

## Best next content step

Replace placeholder image URLs in the database with real hosted product images, starting from best-selling or most visible products first.
