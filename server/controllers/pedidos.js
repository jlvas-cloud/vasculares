/**
 * Pedidos Controller
 * Handles supplier order tracking (internal only, not synced to SAP)
 */
const { getPedidosModel, getProductosModel } = require('../getModel');

/**
 * POST /api/pedidos
 * Create a new supplier order
 *
 * Body: {
 *   orderDate: Date (optional, defaults to now),
 *   expectedArrivalDate: Date (optional),
 *   supplier: String (optional),
 *   notes: String (optional),
 *   items: [{
 *     productId: ObjectId,
 *     quantityOrdered: Number
 *   }]
 * }
 */
exports.create = async (req, res, next) => {
  try {
    const { orderDate, expectedArrivalDate, supplier, notes, items } = req.body;
    const companyId = req.companyId;
    const user = req.user;

    // Validate
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'items are required' });
    }

    for (const item of items) {
      if (!item.productId || !item.quantityOrdered || item.quantityOrdered < 1) {
        return res.status(400).json({ error: 'Each item requires productId and quantityOrdered >= 1' });
      }
    }

    const Pedidos = await getPedidosModel(companyId);

    const pedido = new Pedidos({
      orderDate: orderDate || new Date(),
      expectedArrivalDate,
      supplier,
      notes,
      status: 'PENDIENTE',
      items: items.map(item => ({
        productId: item.productId,
        quantityOrdered: item.quantityOrdered,
        quantityReceived: 0,
      })),
      createdBy: {
        _id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
      },
      companyId,
    });

    await pedido.save();

    res.status(201).json(pedido);
  } catch (error) {
    console.error('Error creating pedido:', error);
    next(error);
  }
};

/**
 * GET /api/pedidos
 * List pedidos with optional filters
 *
 * Query params:
 *   status: 'PENDIENTE' | 'PARCIAL' | 'COMPLETO' | 'CANCELADO'
 *   startDate: ISO date string
 *   endDate: ISO date string
 */
exports.getAll = async (req, res, next) => {
  try {
    const { status, startDate, endDate } = req.query;
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);

    const query = { companyId };

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }

    const pedidos = await Pedidos.find(query)
      .sort({ orderDate: -1 })
      .limit(100)
      .lean();

    // Populate product info
    const Productos = await getProductosModel(companyId);
    const productIds = [...new Set(pedidos.flatMap(p => p.items.map(i => i.productId.toString())))];
    const products = await Productos.find({ _id: { $in: productIds } }).lean();
    const productMap = {};
    products.forEach(p => { productMap[p._id.toString()] = p; });

    // Enrich items with product info
    const enrichedPedidos = pedidos.map(pedido => ({
      ...pedido,
      items: pedido.items.map(item => ({
        ...item,
        product: productMap[item.productId.toString()] || null,
      })),
    }));

    res.json(enrichedPedidos);
  } catch (error) {
    console.error('Error getting pedidos:', error);
    next(error);
  }
};

/**
 * GET /api/pedidos/:id
 * Get single pedido by ID
 */
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);
    const pedido = await Pedidos.findOne({ _id: id, companyId }).lean();

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido not found' });
    }

    // Populate product info
    const Productos = await getProductosModel(companyId);
    const productIds = pedido.items.map(i => i.productId);
    const products = await Productos.find({ _id: { $in: productIds } }).lean();
    const productMap = {};
    products.forEach(p => { productMap[p._id.toString()] = p; });

    const enrichedPedido = {
      ...pedido,
      items: pedido.items.map(item => ({
        ...item,
        product: productMap[item.productId.toString()] || null,
      })),
    };

    res.json(enrichedPedido);
  } catch (error) {
    console.error('Error getting pedido:', error);
    next(error);
  }
};

/**
 * PUT /api/pedidos/:id
 * Update pedido (adjust quantities, cancel, etc.)
 *
 * Body: {
 *   expectedArrivalDate: Date (optional),
 *   supplier: String (optional),
 *   notes: String (optional),
 *   status: String (optional, for cancellation)
 *   items: [{ productId, quantityOrdered }] (optional, to adjust)
 * }
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { expectedArrivalDate, supplier, notes, status, items } = req.body;
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);
    const pedido = await Pedidos.findOne({ _id: id, companyId });

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido not found' });
    }

    // Don't allow changes to COMPLETO or CANCELADO orders (except notes)
    if (pedido.status === 'COMPLETO' || pedido.status === 'CANCELADO') {
      if (notes !== undefined) {
        pedido.notes = notes;
        await pedido.save();
        return res.json(pedido);
      }
      return res.status(400).json({ error: 'Cannot modify completed or cancelled orders' });
    }

    // Update fields
    if (expectedArrivalDate !== undefined) pedido.expectedArrivalDate = expectedArrivalDate;
    if (supplier !== undefined) pedido.supplier = supplier;
    if (notes !== undefined) pedido.notes = notes;

    // Handle cancellation
    if (status === 'CANCELADO') {
      pedido.status = 'CANCELADO';
      await pedido.save();
      return res.json(pedido);
    }

    // Update items if provided
    if (items && Array.isArray(items)) {
      for (const updatedItem of items) {
        const existingItem = pedido.items.find(
          i => i.productId.toString() === updatedItem.productId.toString()
        );
        if (existingItem && updatedItem.quantityOrdered !== undefined) {
          existingItem.quantityOrdered = updatedItem.quantityOrdered;
        }
      }
    }

    await pedido.save();
    res.json(pedido);
  } catch (error) {
    console.error('Error updating pedido:', error);
    next(error);
  }
};

/**
 * DELETE /api/pedidos/:id
 * Cancel pedido (soft delete via status change)
 */
exports.cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);
    const pedido = await Pedidos.findOne({ _id: id, companyId });

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido not found' });
    }

    if (pedido.status === 'COMPLETO') {
      return res.status(400).json({ error: 'Cannot cancel a completed order' });
    }

    pedido.status = 'CANCELADO';
    await pedido.save();

    res.json({ message: 'Pedido cancelled', pedido });
  } catch (error) {
    console.error('Error cancelling pedido:', error);
    next(error);
  }
};

/**
 * GET /api/pedidos/pending-by-product
 * Get pending quantities per product (for planning calculation)
 *
 * Returns: { productId1: pendingQty, productId2: pendingQty, ... }
 */
exports.getPendingByProduct = async (req, res, next) => {
  try {
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);

    // Get all PENDIENTE and PARCIAL pedidos
    const pedidos = await Pedidos.find({
      companyId,
      status: { $in: ['PENDIENTE', 'PARCIAL'] },
    }).lean();

    // Aggregate pending quantities by product
    const pendingByProduct = {};

    for (const pedido of pedidos) {
      for (const item of pedido.items) {
        const pending = Math.max(0, item.quantityOrdered - item.quantityReceived);
        if (pending > 0) {
          const productId = item.productId.toString();
          pendingByProduct[productId] = (pendingByProduct[productId] || 0) + pending;
        }
      }
    }

    res.json(pendingByProduct);
  } catch (error) {
    console.error('Error getting pending by product:', error);
    next(error);
  }
};

/**
 * POST /api/pedidos/:id/receive
 * Record receipt of items (called when GoodsReceipt is created)
 *
 * Body: {
 *   items: [{
 *     productId: ObjectId,
 *     quantityReceived: Number
 *   }],
 *   goodsReceiptId: ObjectId (optional, to link)
 * }
 */
exports.receiveItems = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items, goodsReceiptId } = req.body;
    const companyId = req.companyId;

    const Pedidos = await getPedidosModel(companyId);
    const pedido = await Pedidos.findOne({ _id: id, companyId });

    if (!pedido) {
      return res.status(404).json({ error: 'Pedido not found' });
    }

    if (pedido.status === 'COMPLETO' || pedido.status === 'CANCELADO') {
      return res.status(400).json({ error: 'Cannot receive items for completed or cancelled orders' });
    }

    // Update received quantities
    for (const receivedItem of items) {
      const pedidoItem = pedido.items.find(
        i => i.productId.toString() === receivedItem.productId.toString()
      );
      if (pedidoItem) {
        pedidoItem.quantityReceived += receivedItem.quantityReceived;
      }
    }

    // Link GoodsReceipt if provided
    if (goodsReceiptId) {
      const alreadyLinked = pedido.goodsReceipts.some(
        grId => grId.toString() === goodsReceiptId.toString()
      );
      if (!alreadyLinked) {
        pedido.goodsReceipts.push(goodsReceiptId);
      }
    }

    // Update status
    pedido.updateStatus();

    await pedido.save();
    res.json(pedido);
  } catch (error) {
    console.error('Error receiving items:', error);
    next(error);
  }
};

/**
 * GET /api/pedidos/suggest-for-items
 * Find matching pedidos for GoodsReceipt items
 *
 * Query: productIds=id1,id2,id3
 * Returns: Array of pedidos with matching pending items
 */
exports.suggestForItems = async (req, res, next) => {
  try {
    const { productIds } = req.query;
    const companyId = req.companyId;

    if (!productIds) {
      return res.status(400).json({ error: 'productIds query param required' });
    }

    const productIdArray = productIds.split(',');

    const Pedidos = await getPedidosModel(companyId);

    // Find pedidos with pending items matching these products
    const pedidos = await Pedidos.find({
      companyId,
      status: { $in: ['PENDIENTE', 'PARCIAL'] },
      'items.productId': { $in: productIdArray },
    })
      .sort({ orderDate: 1 }) // Oldest first (FIFO)
      .lean();

    // Filter to only show items with pending quantities
    const suggestions = pedidos.map(pedido => ({
      ...pedido,
      items: pedido.items.filter(item =>
        productIdArray.includes(item.productId.toString()) &&
        item.quantityOrdered > item.quantityReceived
      ),
    })).filter(pedido => pedido.items.length > 0);

    res.json(suggestions);
  } catch (error) {
    console.error('Error suggesting pedidos:', error);
    next(error);
  }
};
