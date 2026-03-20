import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "../controllers/addressController";

const router = Router();

// All address routes require a valid JWT — no public access
router.use(requireAuth);

/**
 * GET  /api/addresses
 * Returns all addresses belonging to the authenticated user.
 * Optional query param: ?type=billing|shipping
 */
router.get("/addresses", listAddresses);

/**
 * POST /api/addresses
 * Body: { street_address, city, state, pin_code, country, address_type, land_mark? }
 * user_id is taken from the JWT — never from the request body.
 */
router.post("/addresses", createAddress);

/**
 * PUT /api/addresses/:id
 * Body: any subset of address fields (at least one required)
 * Only the address owner can update it.
 */
router.put("/addresses/:id", updateAddress);

/**
 * DELETE /api/addresses/:id
 * Only the address owner can delete it.
 */
router.delete("/addresses/:id", deleteAddress);

export default router;
