import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsApi, locacionesApi, productosApi, inventarioObjetivosApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle2, Edit, Warehouse } from 'lucide-react';

export default function Planning() {
  const [category, setCategory] = useState('all');
  const [location, setLocation] = useState('warehouse');
  const [editingProduct, setEditingProduct] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isWarehouseView = location === 'warehouse';

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: planningData, isLoading } = useQuery({
    queryKey: ['planning-data', category, location],
    queryFn: () => {
      const params = {};
      if (category && category !== 'all') params.category = category;
      if (location && location !== 'warehouse') params.locationId = location;
      return analyticsApi.getPlanningData(params).then((res) => res.data);
    },
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
      toast.error(error.response?.data?.error || 'Error al actualizar');
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
      toast.error(error.response?.data?.error || 'Error al actualizar');
    },
  });

  const handleEdit = (product) => {
    setEditingProduct(product);
    setEditOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    if (isWarehouseView) {
      // Update product inventory settings
      const data = {
        inventorySettings: {
          targetStockWarehouse: parseInt(formData.get('targetStock')) || 0,
          reorderPoint: parseInt(formData.get('reorderPoint')) || 0,
          minStockLevel: parseInt(formData.get('minStock')) || 0,
          maxStockLevel: parseInt(formData.get('maxStock')) || 0,
        },
      };
      updateProductMutation.mutate({ productId: editingProduct.productId, data });
    } else {
      // Upsert location target
      const data = {
        productId: editingProduct.productId,
        locationId: location,
        targetStock: parseInt(formData.get('targetStock')) || 0,
        reorderPoint: parseInt(formData.get('reorderPoint')) || 0,
        minStockLevel: parseInt(formData.get('minStock')) || 0,
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
      default:
        return 'bg-gray-100 text-gray-800';
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
      default:
        return null;
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'critical':
        return 'Crítico';
      case 'warning':
        return 'Advertencia';
      case 'ok':
        return 'OK';
      default:
        return 'N/A';
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

  if (isLoading) return <div>Cargando...</div>;

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
                      <span>Almacén Central</span>
                    </div>
                  </SelectItem>
                  {locations
                    ?.filter((loc) => loc.type === 'HOSPITAL' || loc.type === 'CLINIC')
                    .map((loc) => (
                      <SelectItem key={loc._id} value={loc._id}>
                        {loc.name} ({loc.type === 'HOSPITAL' ? 'Hospital' : 'Clínica'})
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
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Planning Table */}
      <Card>
        <CardHeader>
          <CardTitle>Productos ({planningData?.length || 0})</CardTitle>
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
                      <th className="text-right p-2 font-medium">En Consignación</th>
                    </>
                  ) : (
                    <th className="text-right p-2 font-medium">Stock Actual</th>
                  )}
                  <th className="text-right p-2 font-medium">Consumo Mensual Prom.</th>
                  <th className="text-right p-2 font-medium">Días Cobertura</th>
                  <th className="text-right p-2 font-medium">Stock Objetivo</th>
                  <th className="text-right p-2 font-medium">Punto Reorden</th>
                  <th className="text-right p-2 font-medium">
                    {isWarehouseView ? 'Sugerido Ordenar' : 'Sugerido Consignar'}
                  </th>
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
                                  currentStock < product.minStock
                                    ? 'text-red-600'
                                    : currentStock <= product.reorderPoint
                                    ? 'text-yellow-600'
                                    : 'text-green-600'
                                }`}
                              >
                                {currentStock}
                              </span>
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {product.consignedStock}
                            </td>
                          </>
                        ) : (
                          <td className="p-2 text-right">
                            <span
                              className={`font-medium ${
                                currentStock < product.minStock
                                  ? 'text-red-600'
                                  : currentStock <= product.reorderPoint
                                  ? 'text-yellow-600'
                                  : 'text-green-600'
                              }`}
                            >
                              {currentStock}
                            </span>
                          </td>
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
                        <td className="p-2 text-right text-muted-foreground">
                          {product.reorderPoint || '-'}
                        </td>
                        <td className="p-2 text-right">
                          {suggested > 0 ? (
                            <span className="font-medium text-blue-600">{suggested}</span>
                          ) : (
                            '-'
                          )}
                        </td>
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
                    <td colSpan="11" className="p-8 text-center text-muted-foreground">
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
                  <Label htmlFor="targetStock">Stock Objetivo *</Label>
                  <Input
                    id="targetStock"
                    name="targetStock"
                    type="number"
                    min="0"
                    defaultValue={editingProduct.targetStock || 0}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Cantidad ideal a mantener
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reorderPoint">Punto de Reorden *</Label>
                  <Input
                    id="reorderPoint"
                    name="reorderPoint"
                    type="number"
                    min="0"
                    defaultValue={editingProduct.reorderPoint || 0}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {isWarehouseView
                      ? 'Disparar orden cuando baje de este nivel'
                      : 'Disparar consignación cuando baje de este nivel'}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="minStock">Stock Mínimo *</Label>
                  <Input
                    id="minStock"
                    name="minStock"
                    type="number"
                    min="0"
                    defaultValue={editingProduct.minStock || 0}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Stock de seguridad</p>
                </div>
                {isWarehouseView && (
                  <div className="grid gap-2">
                    <Label htmlFor="maxStock">Stock Máximo</Label>
                    <Input
                      id="maxStock"
                      name="maxStock"
                      type="number"
                      min="0"
                      defaultValue={editingProduct.maxStock || 0}
                    />
                    <p className="text-xs text-muted-foreground">
                      Evitar sobre-stock
                    </p>
                  </div>
                )}
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
    </div>
  );
}
