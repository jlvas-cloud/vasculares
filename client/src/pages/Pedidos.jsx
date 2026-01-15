import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pedidosApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ShoppingCart, Filter, X, ChevronDown, ChevronUp, Package, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { useToast } from '../components/ui/toast';

export default function Pedidos() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState({
    status: '',
    startDate: '',
    endDate: '',
  });
  const [expandedPedido, setExpandedPedido] = useState(null);
  const [cancelDialog, setCancelDialog] = useState(null);

  const { data: pedidos, isLoading } = useQuery({
    queryKey: ['pedidos', filters],
    queryFn: () => {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      return pedidosApi.getAll(params).then((res) => res.data);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (pedidoId) => pedidosApi.cancel(pedidoId),
    onSuccess: () => {
      queryClient.invalidateQueries(['pedidos']);
      toast.success('Pedido cancelado');
      setCancelDialog(null);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al cancelar pedido');
    },
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      status: '',
      startDate: '',
      endDate: '',
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDIENTE':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-0">
            <Clock className="h-3 w-3 mr-1" />
            Pendiente
          </Badge>
        );
      case 'PARCIAL':
        return (
          <Badge className="bg-blue-100 text-blue-800 border-0">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Parcial
          </Badge>
        );
      case 'COMPLETO':
        return (
          <Badge className="bg-green-100 text-green-800 border-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completo
          </Badge>
        );
      case 'CANCELADO':
        return (
          <Badge className="bg-gray-100 text-gray-600 border-0">
            <XCircle className="h-3 w-3 mr-1" />
            Cancelado
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getTotalItems = (pedido) => {
    return pedido.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
  };

  const getTotalReceived = (pedido) => {
    return pedido.items.reduce((sum, item) => sum + item.quantityReceived, 0);
  };

  const getTotalPending = (pedido) => {
    return pedido.items.reduce((sum, item) => sum + Math.max(0, item.quantityOrdered - item.quantityReceived), 0);
  };

  // Calculate summary stats
  const stats = pedidos
    ? {
        total: pedidos.length,
        pendiente: pedidos.filter((p) => p.status === 'PENDIENTE').length,
        parcial: pedidos.filter((p) => p.status === 'PARCIAL').length,
        completo: pedidos.filter((p) => p.status === 'COMPLETO').length,
        totalUnidadesPendientes: pedidos
          .filter((p) => p.status === 'PENDIENTE' || p.status === 'PARCIAL')
          .reduce((sum, p) => sum + getTotalPending(p), 0),
      }
    : { total: 0, pendiente: 0, parcial: 0, completo: 0, totalUnidadesPendientes: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ShoppingCart className="h-8 w-8 text-purple-600" />
          Pedidos a Proveedor
        </h1>
        <p className="text-muted-foreground">
          Seguimiento de pedidos al fabricante (uso interno, no sincronizado con SAP)
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pedidos</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.pendiente}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Parciales</CardTitle>
            <AlertTriangle className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.parcial}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completos</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completo}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unidades Por Recibir</CardTitle>
            <Package className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats.totalUnidadesPendientes}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filtros
            </CardTitle>
            {(filters.status || filters.startDate || filters.endDate) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Estado</Label>
              <Select value={filters.status || 'all'} onValueChange={(v) => handleFilterChange('status', v === 'all' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="PENDIENTE">Pendiente</SelectItem>
                  <SelectItem value="PARCIAL">Parcial</SelectItem>
                  <SelectItem value="COMPLETO">Completo</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Desde</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Hasta</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pedidos List */}
      <Card>
        <CardHeader>
          <CardTitle>Pedidos ({pedidos?.length || 0})</CardTitle>
          <CardDescription>
            Lista de pedidos ordenados por fecha (más reciente primero)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Cargando pedidos...
            </div>
          ) : pedidos?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay pedidos registrados</p>
              <p className="text-sm mt-1">
                Los pedidos se crean desde la página de Planificación
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pedidos?.map((pedido) => {
                const isExpanded = expandedPedido === pedido._id;
                const totalOrdered = getTotalItems(pedido);
                const totalReceived = getTotalReceived(pedido);
                const totalPending = getTotalPending(pedido);

                return (
                  <div
                    key={pedido._id}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Header */}
                    <div
                      className="p-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpandedPedido(isExpanded ? null : pedido._id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {formatDate(pedido.orderDate)}
                            </span>
                            {getStatusBadge(pedido.status)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pedido.items.length} producto{pedido.items.length !== 1 ? 's' : ''} •
                            {' '}{totalOrdered} ordenados
                            {totalReceived > 0 && ` • ${totalReceived} recibidos`}
                            {totalPending > 0 && (
                              <span className="text-purple-600 font-medium">
                                {' '}• {totalPending} pendientes
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {(pedido.status === 'PENDIENTE' || pedido.status === 'PARCIAL') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCancelDialog(pedido);
                            }}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-4">
                        {/* Meta info */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                          {pedido.supplier && (
                            <div>
                              <span className="text-muted-foreground">Proveedor:</span>
                              <span className="ml-2 font-medium">{pedido.supplier}</span>
                            </div>
                          )}
                          {pedido.expectedArrivalDate && (
                            <div>
                              <span className="text-muted-foreground">Llegada esperada:</span>
                              <span className="ml-2 font-medium">
                                {formatDate(pedido.expectedArrivalDate)}
                              </span>
                            </div>
                          )}
                          <div>
                            <span className="text-muted-foreground">Creado por:</span>
                            <span className="ml-2 font-medium">
                              {pedido.createdBy?.firstname} {pedido.createdBy?.lastname}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">ID:</span>
                            <span className="ml-2 font-mono text-xs">{pedido._id}</span>
                          </div>
                        </div>

                        {/* Notes */}
                        {pedido.notes && (
                          <div className="mb-4 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                            <span className="text-muted-foreground">Notas:</span>
                            <span className="ml-2">{pedido.notes}</span>
                          </div>
                        )}

                        {/* Items table */}
                        <div className="border rounded bg-white">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/30">
                                <th className="text-left p-2 font-medium">Producto</th>
                                <th className="text-left p-2 font-medium">Tamaño</th>
                                <th className="text-right p-2 font-medium">Ordenado</th>
                                <th className="text-right p-2 font-medium">Recibido</th>
                                <th className="text-right p-2 font-medium">Pendiente</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pedido.items.map((item, idx) => {
                                const product = item.product;
                                const pending = Math.max(0, item.quantityOrdered - item.quantityReceived);
                                return (
                                  <tr key={idx} className="border-b last:border-0 hover:bg-muted/20">
                                    <td className="p-2">
                                      {product ? (
                                        <div>
                                          <div className="font-medium">{product.name}</div>
                                          <div className="text-xs text-muted-foreground">
                                            Código: {product.code}
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">Producto no encontrado</span>
                                      )}
                                    </td>
                                    <td className="p-2">
                                      {product?.specifications?.size || '-'}
                                    </td>
                                    <td className="p-2 text-right font-medium">
                                      {item.quantityOrdered}
                                    </td>
                                    <td className="p-2 text-right">
                                      {item.quantityReceived > 0 ? (
                                        <span className="text-green-600 font-medium">
                                          {item.quantityReceived}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="p-2 text-right">
                                      {pending > 0 ? (
                                        <span className="text-purple-600 font-medium">
                                          {pending}
                                        </span>
                                      ) : (
                                        <span className="text-green-600">
                                          <CheckCircle2 className="h-4 w-4 inline" />
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Linked GoodsReceipts */}
                        {pedido.goodsReceipts?.length > 0 && (
                          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
                            <div className="text-sm font-medium text-green-800 mb-1">
                              Entradas de Mercancía Vinculadas:
                            </div>
                            <div className="text-sm text-green-700">
                              {pedido.goodsReceipts.length} entrada{pedido.goodsReceipts.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Confirmation Dialog */}
      {cancelDialog && (
        <Dialog open={!!cancelDialog} onOpenChange={() => setCancelDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                Cancelar Pedido
              </DialogTitle>
              <DialogDescription>
                Esta acción cancelará el pedido y no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm">
                <div className="font-medium text-red-800 mb-2">
                  Pedido del {formatDate(cancelDialog.orderDate)}
                </div>
                <div className="text-red-700">
                  {cancelDialog.items.length} producto{cancelDialog.items.length !== 1 ? 's' : ''} •
                  {' '}{getTotalItems(cancelDialog)} unidades ordenadas
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCancelDialog(null)}
                disabled={cancelMutation.isPending}
              >
                Volver
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelMutation.mutate(cancelDialog._id)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Cancelar Pedido
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
