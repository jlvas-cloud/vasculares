import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { analyticsApi, locacionesApi, productosApi, inventarioObjetivosApi, consignacionesApi, inventarioApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle2, Edit, Warehouse, Truck, Loader2, Check, Package, ChevronDown, ChevronRight } from 'lucide-react';

export default function Planning() {
  const [category, setCategory] = useState('all');
  const [location, setLocation] = useState('warehouse');
  const [editingProduct, setEditingProduct] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [consignmentOpen, setConsignmentOpen] = useState(false);
  const [consignmentItems, setConsignmentItems] = useState([]);
  const [expandedProducts, setExpandedProducts] = useState({});
  const [warehouseLots, setWarehouseLots] = useState({});
  const [loadingLots, setLoadingLots] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const isWarehouseView = location === 'warehouse';
  const isCentroView = !isWarehouseView;

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: planningData, isLoading, isFetching } = useQuery({
    queryKey: ['planning-data', category, location],
    queryFn: () => {
      const params = {};
      if (category && category !== 'all') params.category = category;
      if (location && location !== 'warehouse') params.locationId = location;
      return analyticsApi.getPlanningData(params).then((res) => res.data);
    },
    placeholderData: keepPreviousData,
  });

  // Mutation for updating product inventory settings (warehouse view)
  const updateProductMutation = useMutation({
    mutationFn: ({ productId, data }) => productosApi.update(productId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['planning-data']);
      setEditOpen(false);
      setEditingProduct(null);
      toast.success('Stock objetivo actualizado');
    },
    onError: (error) => {
      console.error('Update error:', error);
      const message = error?.response?.data?.error || error?.message || 'Error al actualizar';
      toast.error(message);
    },
  });

  // Mutation for upserting location targets (location view)
  const upsertTargetMutation = useMutation({
    mutationFn: (data) => inventarioObjetivosApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['planning-data']);
      setEditOpen(false);
      setEditingProduct(null);
      toast.success('Objetivo de locación actualizado');
    },
    onError: (error) => {
      console.error('Upsert error:', error);
      const message = error?.response?.data?.error || error?.message || 'Error al actualizar';
      toast.error(message);
    },
  });

  // Mutation for creating consignment
  const createConsignmentMutation = useMutation({
    mutationFn: consignacionesApi.create,
    onSuccess: (response) => {
      queryClient.invalidateQueries(['planning-data']);

      // Close dialog immediately
      setConsignmentOpen(false);
      setConsignmentItems([]);
      createConsignmentMutation.reset();

      // Show success toast after closing so it's visible
      setTimeout(() => {
        toast.success('¡Consignación creada exitosamente! Stock deducido del almacén.');
      }, 100);
    },
    onError: (error) => {
      console.error('Consignment error:', error);
      const message = error?.response?.data?.error || error?.message || 'Error al crear consignación';
      toast.error(`Error: ${message}`);
    },
  });

  const handleEdit = (product) => {
    setEditingProduct(product);
    setEditOpen(true);
  };

  // Load lots for warehouse when opening consignment dialog
  const loadWarehouseLots = async (warehouseId, productIds) => {
    setLoadingLots(true);
    try {
      const response = await inventarioApi.getLotesByLocation(warehouseId);
      const lots = response.data;

      // Group lots by product
      const lotsByProduct = {};
      for (const lot of lots) {
        const productId = lot.productId?._id || lot.productId;
        if (!lotsByProduct[productId]) {
          lotsByProduct[productId] = [];
        }
        // Only include active lots with available quantity
        if (lot.status === 'ACTIVE' && lot.quantityAvailable > 0) {
          lotsByProduct[productId].push({
            _id: lot._id,
            lotNumber: lot.lotNumber,
            quantityAvailable: lot.quantityAvailable,
            expiryDate: lot.expiryDate,
            quantityToSend: 0,
          });
        }
      }
      setWarehouseLots(lotsByProduct);
    } catch (error) {
      console.error('Error loading warehouse lots:', error);
      toast.error('Error cargando lotes del almacén');
    } finally {
      setLoadingLots(false);
    }
  };

  const handleCreateConsignment = () => {
    // Build items from lot selections
    const items = [];

    for (const item of consignmentItems) {
      if (!item.included) continue;

      const productLots = warehouseLots[item.productId] || [];
      const lotsWithQuantity = productLots.filter(lot => lot.quantityToSend > 0);

      if (lotsWithQuantity.length > 0) {
        // Add each lot as a separate item
        for (const lot of lotsWithQuantity) {
          items.push({
            productId: item.productId,
            loteId: lot._id,
            lotNumber: lot.lotNumber,
            quantitySent: lot.quantityToSend,
          });
        }
      } else if (item.quantityToSend > 0) {
        // Fallback to FIFO allocation (backend will handle)
        items.push({
          productId: item.productId,
          quantitySent: item.quantityToSend,
        });
      }
    }

    if (items.length === 0) {
      toast.warning('Selecciona al menos un producto para consignar');
      return;
    }

    // Find warehouse location
    const warehouseLocation = locations?.find(loc => loc.type === 'WAREHOUSE');
    if (!warehouseLocation) {
      toast.error('No se encontró almacén');
      return;
    }

    const consignmentData = {
      fromLocationId: warehouseLocation._id,
      toLocationId: location,
      items,
      notes: '',
    };

    createConsignmentMutation.mutate(consignmentData);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const targetStock = parseInt(formData.get('targetStock')) || 0;

    if (isWarehouseView) {
      // Update product inventory settings
      const data = {
        inventorySettings: {
          targetStockWarehouse: targetStock,
        },
      };
      updateProductMutation.mutate({ productId: editingProduct.productId, data });
    } else {
      // Upsert location target
      const data = {
        productId: editingProduct.productId,
        locationId: location,
        targetStock,
      };
      upsertTargetMutation.mutate(data);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'ok':
        return 'bg-green-100 text-green-800';
      case 'sin_configurar':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'critical':
        return 'Crítico';
      case 'warning':
        return 'Atención';
      case 'ok':
        return 'OK';
      case 'sin_configurar':
        return 'Sin Config.';
      default:
        return status;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warning':
        return <TrendingUp className="h-4 w-4" />;
      case 'ok':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'sin_configurar':
        return <Edit className="h-4 w-4" />;
      default:
        return null;
    }
  };

  // Calculate summary stats
  const stats = planningData
    ? {
        total: planningData.length,
        critical: planningData.filter((p) => p.status === 'critical').length,
        warning: planningData.filter((p) => p.status === 'warning').length,
        totalSuggested: isWarehouseView
          ? planningData.reduce((sum, p) => sum + (p.suggestedOrder || 0), 0)
          : planningData.reduce((sum, p) => sum + (p.suggestedConsignment || 0), 0),
      }
    : { total: 0, critical: 0, warning: 0, totalSuggested: 0 };

  // Show initial loading only on first load (no data yet)
  if (isLoading && !planningData) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Planificación de Inventario</h1>
        <p className="text-muted-foreground">
          {isWarehouseView
            ? 'Vista de almacén central - órdenes al fabricante'
            : 'Vista por locación - consignaciones sugeridas'}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Productos</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nivel Crítico</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.critical}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Advertencias</CardTitle>
            <TrendingUp className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.warning}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {isWarehouseView ? 'Total a Ordenar' : 'Total a Consignar'}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSuggested}</div>
            <p className="text-xs text-muted-foreground">unidades sugeridas</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Filtros</CardTitle>
            {isCentroView && (
              <Button onClick={async () => {
                // Find warehouse location first
                const warehouseLocation = locations?.find(loc => loc.type === 'WAREHOUSE');
                if (!warehouseLocation) {
                  toast.error('No se encontró almacén');
                  return;
                }

                // Prepare consignment items from planning data
                const items = (planningData || [])
                  .filter(p => p.suggestedConsignment > 0 && p.warehouseStock > 0)
                  .map(p => ({
                    productId: p.productId,
                    productName: p.name,
                    productCode: p.code,
                    size: p.size,
                    suggestedConsignment: p.suggestedConsignment,
                    warehouseStock: p.warehouseStock,
                    quantityToSend: Math.min(p.suggestedConsignment, p.warehouseStock),
                    included: true,
                  }));
                setConsignmentItems(items);
                setExpandedProducts({});
                setWarehouseLots({});
                setConsignmentOpen(true);

                // Load lots from warehouse
                await loadWarehouseLots(warehouseLocation._id);
              }}>
                <Truck className="mr-2 h-4 w-4" />
                Crear Consignación
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Locación</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse">
                    <div className="flex items-center gap-2">
                      <Warehouse className="h-4 w-4" />
                      <span>Todos los Almacenes (Agregado)</span>
                    </div>
                  </SelectItem>
                  {locations
                    ?.filter((loc) => loc.type === 'WAREHOUSE')
                    .map((loc) => (
                      <SelectItem key={loc._id} value={loc._id}>
                        <div className="flex items-center gap-2">
                          <Warehouse className="h-4 w-4" />
                          <span>{loc.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  {locations
                    ?.filter((loc) => loc.type === 'CENTRO' || loc.type === 'HOSPITAL' || loc.type === 'CLINIC')
                    .map((loc) => (
                      <SelectItem key={loc._id} value={loc._id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="GUIAS">Guías</SelectItem>
                  <SelectItem value="STENTS_CORONARIOS">Stents Coronarios</SelectItem>
                  <SelectItem value="STENTS_RECUBIERTOS">Stents Recubiertos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Planning Table */}
      <Card className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Productos ({planningData?.length || 0})</CardTitle>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <CardDescription>
            {isWarehouseView
              ? 'Gestión de inventario y órdenes al fabricante'
              : 'Gestión de consignación y reposición por locación'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">Producto</th>
                  <th className="text-left p-2 font-medium">Tamaño</th>
                  {isWarehouseView ? (
                    <>
                      <th className="text-right p-2 font-medium">Stock Almacén</th>
                      <th className="text-right p-2 font-medium">En Tránsito</th>
                      <th className="text-right p-2 font-medium">En Centros</th>
                      <th className="text-right p-2 font-medium">Total</th>
                    </>
                  ) : (
                    <>
                      <th className="text-right p-2 font-medium">Stock Actual</th>
                      <th className="text-right p-2 font-medium">En Tránsito</th>
                    </>
                  )}
                  <th className="text-right p-2 font-medium">Consumo Mensual</th>
                  <th className="text-right p-2 font-medium">Días Cobertura</th>
                  <th className="text-right p-2 font-medium">Stock Objetivo</th>
                  <th className="text-right p-2 font-medium">
                    {isWarehouseView ? 'Sugerido Ordenar' : 'Sugerido Consignar'}
                  </th>
                  {!isWarehouseView && (
                    <th className="text-right p-2 font-medium">Disp. Almacén</th>
                  )}
                  <th className="text-center p-2 font-medium">Estado</th>
                  <th className="text-center p-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {planningData && planningData.length > 0 ? (
                  planningData.map((product) => {
                    const currentStock = isWarehouseView
                      ? product.warehouseStock
                      : product.currentStock;
                    const suggested = isWarehouseView
                      ? product.suggestedOrder
                      : product.suggestedConsignment;

                    return (
                      <tr key={product.productId} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Código: {product.code}
                            </div>
                          </div>
                        </td>
                        <td className="p-2">{product.size}</td>
                        {isWarehouseView ? (
                          <>
                            <td className="p-2 text-right">
                              <span
                                className={`font-medium ${
                                  product.status === 'critical'
                                    ? 'text-red-600'
                                    : product.status === 'warning'
                                    ? 'text-yellow-600'
                                    : product.status === 'sin_configurar'
                                    ? 'text-blue-600'
                                    : 'text-green-600'
                                }`}
                              >
                                {currentStock}
                              </span>
                            </td>
                            <td className="p-2 text-right">
                              {product.warehouseInTransit > 0 ? (
                                <span className="text-orange-600 font-medium">
                                  {product.warehouseInTransit}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {product.consignedStock}
                            </td>
                            <td className="p-2 text-right">
                              <span className="font-medium">
                                {product.totalStock + (product.warehouseInTransit || 0)}
                              </span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-2 text-right">
                              <span
                                className={`font-medium ${
                                  product.status === 'critical'
                                    ? 'text-red-600'
                                    : product.status === 'warning'
                                    ? 'text-yellow-600'
                                    : product.status === 'sin_configurar'
                                    ? 'text-blue-600'
                                    : 'text-green-600'
                                }`}
                              >
                                {currentStock}
                              </span>
                            </td>
                            <td className="p-2 text-right">
                              {product.inTransit > 0 ? (
                                <span className="text-orange-600 font-medium">
                                  {product.inTransit}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="p-2 text-right">
                          {product.avgMonthlyConsumption > 0
                            ? product.avgMonthlyConsumption.toFixed(1)
                            : '-'}
                        </td>
                        <td className="p-2 text-right">
                          {product.daysOfCoverage < 999 ? (
                            <span
                              className={
                                product.daysOfCoverage < 15
                                  ? 'text-red-600 font-medium'
                                  : product.daysOfCoverage < 30
                                  ? 'text-yellow-600 font-medium'
                                  : 'text-green-600'
                              }
                            >
                              {product.daysOfCoverage}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {product.targetStock || '-'}
                        </td>
                        <td className="p-2 text-right">
                          {suggested > 0 ? (
                            <span className="font-medium text-blue-600">{suggested}</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        {!isWarehouseView && (
                          <td className="p-2 text-right">
                            <span
                              className={`font-medium ${
                                product.warehouseStock > 0
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {product.warehouseStock || 0}
                            </span>
                          </td>
                        )}
                        <td className="p-2 text-center">
                          <Badge
                            variant="outline"
                            className={`${getStatusColor(product.status)} border-0`}
                          >
                            <div className="flex items-center gap-1">
                              {getStatusIcon(product.status)}
                              <span>{getStatusLabel(product.status)}</span>
                            </div>
                          </Badge>
                        </td>
                        <td className="p-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(product)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="12" className="p-8 text-center text-muted-foreground">
                      No hay productos disponibles
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {editingProduct && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <form onSubmit={handleSaveEdit}>
              <DialogHeader>
                <DialogTitle>Editar Niveles de Inventario</DialogTitle>
                <DialogDescription>
                  {isWarehouseView
                    ? `Configurar niveles para almacén central - ${editingProduct.name}`
                    : `Configurar objetivo para ${
                        locations?.find((l) => l._id === location)?.name
                      } - ${editingProduct.name}`}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="targetStock">Stock Objetivo</Label>
                  <Input
                    id="targetStock"
                    name="targetStock"
                    type="number"
                    min="0"
                    defaultValue={editingProduct.targetStock || 0}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Cantidad ideal a mantener. El sugerido a {isWarehouseView ? 'ordenar' : 'consignar'} se calcula como: Stock Objetivo - Stock Actual
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-md text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">Stock Actual:</span>
                    <span className="font-medium">
                      {isWarehouseView ? editingProduct.warehouseStock : editingProduct.currentStock}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{isWarehouseView ? 'Sugerido Ordenar:' : 'Sugerido Consignar:'}</span>
                    <span className="font-medium text-blue-600">
                      {isWarehouseView ? editingProduct.suggestedOrder : editingProduct.suggestedConsignment}
                    </span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    updateProductMutation.isPending || upsertTargetMutation.isPending
                  }
                >
                  {updateProductMutation.isPending || upsertTargetMutation.isPending
                    ? 'Guardando...'
                    : 'Guardar Cambios'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Consignment Creation Dialog */}
      <Dialog open={consignmentOpen} onOpenChange={setConsignmentOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear Consignación</DialogTitle>
            <DialogDescription>
              Selecciona los productos y lotes a consignar. Expande cada producto para ver lotes disponibles.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {loadingLots && (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando lotes disponibles...
              </div>
            )}
            {consignmentItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay productos con necesidad de consignación
              </div>
            ) : (
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 w-12"></th>
                      <th className="text-left p-2">Producto</th>
                      <th className="text-left p-2">Tamaño</th>
                      <th className="text-right p-2">Sugerido</th>
                      <th className="text-right p-2">Disponible</th>
                      <th className="text-right p-2">A Consignar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consignmentItems.map((item, index) => {
                      const productLots = warehouseLots[item.productId] || [];
                      const isExpanded = expandedProducts[item.productId];
                      const totalFromLots = productLots.reduce((sum, lot) => sum + (lot.quantityToSend || 0), 0);

                      return (
                        <>
                          <tr key={item.productId} className="border-b hover:bg-muted/30">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={item.included}
                                onChange={(e) => {
                                  const newItems = [...consignmentItems];
                                  newItems[index].included = e.target.checked;
                                  setConsignmentItems(newItems);
                                }}
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-2">
                                {productLots.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedProducts(prev => ({
                                      ...prev,
                                      [item.productId]: !prev[item.productId]
                                    }))}
                                    className="p-1 hover:bg-muted rounded"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                                <div>
                                  <div className="font-medium">{item.productName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Código: {item.productCode}
                                    {productLots.length > 0 && (
                                      <span className="ml-2 text-blue-600">
                                        ({productLots.length} lotes)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-2">{item.size}</td>
                            <td className="p-2 text-right text-blue-600 font-medium">
                              {item.suggestedConsignment}
                            </td>
                            <td className="p-2 text-right text-green-600 font-medium">
                              {item.warehouseStock}
                            </td>
                            <td className="p-2">
                              <div className="flex justify-end items-center gap-2">
                                {totalFromLots > 0 ? (
                                  <span className="text-sm font-medium text-blue-600">
                                    {totalFromLots} (de lotes)
                                  </span>
                                ) : (
                                  <Input
                                    type="number"
                                    min="0"
                                    max={Math.min(item.suggestedConsignment, item.warehouseStock)}
                                    value={item.quantityToSend}
                                    onChange={(e) => {
                                      const newItems = [...consignmentItems];
                                      newItems[index].quantityToSend = Math.max(0, parseInt(e.target.value) || 0);
                                      setConsignmentItems(newItems);
                                    }}
                                    className="w-20 text-right"
                                    placeholder="FIFO"
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Expanded lots section */}
                          {isExpanded && productLots.length > 0 && (
                            <tr key={`${item.productId}-lots`}>
                              <td colSpan="6" className="bg-muted/20 p-0">
                                <div className="pl-12 pr-4 py-2">
                                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                    <Package className="h-3 w-3" />
                                    Seleccionar lotes (FEFO - primero los que expiran antes)
                                  </div>
                                  <div className="space-y-2">
                                    {productLots.map((lot, lotIndex) => (
                                      <div
                                        key={lot._id}
                                        className="flex items-center justify-between bg-white rounded border p-2"
                                      >
                                        <div className="flex-1">
                                          <div className="font-medium text-sm">{lot.lotNumber}</div>
                                          <div className="text-xs text-muted-foreground">
                                            Vence: {new Date(lot.expiryDate).toLocaleDateString()}
                                            <span className="ml-2">
                                              Disponible: <span className="font-medium text-green-600">{lot.quantityAvailable}</span>
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            min="0"
                                            max={lot.quantityAvailable}
                                            value={lot.quantityToSend || ''}
                                            onChange={(e) => {
                                              const newLots = { ...warehouseLots };
                                              const qty = Math.max(0, Math.min(lot.quantityAvailable, parseInt(e.target.value) || 0));
                                              newLots[item.productId][lotIndex].quantityToSend = qty;
                                              setWarehouseLots(newLots);
                                            }}
                                            placeholder="0"
                                            className="w-16 text-right text-sm"
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              const newLots = { ...warehouseLots };
                                              newLots[item.productId][lotIndex].quantityToSend = lot.quantityAvailable;
                                              setWarehouseLots(newLots);
                                            }}
                                          >
                                            Todo
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="bg-muted/50 p-3 rounded-md">
              <div className="flex justify-between text-sm font-medium">
                <span>Total de productos seleccionados:</span>
                <span>
                  {consignmentItems.filter(item => {
                    if (!item.included) return false;
                    const productLots = warehouseLots[item.productId] || [];
                    const totalFromLots = productLots.reduce((sum, lot) => sum + (lot.quantityToSend || 0), 0);
                    return totalFromLots > 0 || item.quantityToSend > 0;
                  }).length}
                </span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span>Total unidades a consignar:</span>
                <span className="text-blue-600">
                  {consignmentItems.reduce((total, item) => {
                    if (!item.included) return total;
                    const productLots = warehouseLots[item.productId] || [];
                    const totalFromLots = productLots.reduce((sum, lot) => sum + (lot.quantityToSend || 0), 0);
                    return total + (totalFromLots > 0 ? totalFromLots : (item.quantityToSend || 0));
                  }, 0)}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConsignmentOpen(false)}
              disabled={createConsignmentMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateConsignment}
              disabled={
                createConsignmentMutation.isPending ||
                createConsignmentMutation.isSuccess ||
                loadingLots ||
                consignmentItems.filter(item => {
                  if (!item.included) return false;
                  const productLots = warehouseLots[item.productId] || [];
                  const totalFromLots = productLots.reduce((sum, lot) => sum + (lot.quantityToSend || 0), 0);
                  return totalFromLots > 0 || item.quantityToSend > 0;
                }).length === 0
              }
              className={createConsignmentMutation.isSuccess ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              {createConsignmentMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {createConsignmentMutation.isSuccess && (
                <Check className="mr-2 h-4 w-4" />
              )}
              {createConsignmentMutation.isPending
                ? 'Creando Consignación...'
                : createConsignmentMutation.isSuccess
                ? '¡Creada!'
                : 'Confirmar Consignación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
