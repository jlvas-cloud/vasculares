import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { consignacionesApi, locacionesApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { Package, Truck, AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw, Download } from 'lucide-react';

export default function Consignaciones() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedConsignment, setSelectedConsignment] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmItems, setConfirmItems] = useState([]);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const { data: consignaciones, isLoading } = useQuery({
    queryKey: ['consignaciones', statusFilter],
    queryFn: () => {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      return consignacionesApi.getAll(params).then((res) => res.data);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ id, data }) => consignacionesApi.confirm(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['consignaciones']);
      setConfirmOpen(false);
      setSelectedConsignment(null);
      setConfirmItems([]);
      toast.success('Consignación confirmada exitosamente');
    },
    onError: (error) => {
      console.error('Confirm error:', error);
      const message = error?.response?.data?.error || error?.message || 'Error al confirmar consignación';
      toast.error(message);
    },
  });

  const retrySapMutation = useMutation({
    mutationFn: (id) => consignacionesApi.retrySap(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['consignaciones']);
      toast.success(`SAP sync exitoso - DocNum: ${response.data.sapDocNum}`);
      setConfirmOpen(false);
    },
    onError: (error) => {
      console.error('Retry SAP error:', error);
      const message = error?.response?.data?.error || error?.message || 'Error al reintentar SAP';
      toast.error(message);
    },
  });

  const handleViewConsignment = (consignment) => {
    setSelectedConsignment(consignment);
    // Initialize confirm items with sent quantities
    setConfirmItems(
      consignment.items.map((item) => ({
        productId: item.productId._id,
        productName: item.productId.name,
        productCode: item.productId.code,
        size: item.productId.specifications?.size || 'N/A',
        quantitySent: item.quantitySent,
        quantityReceived: item.quantityReceived !== null ? item.quantityReceived : item.quantitySent,
        notes: item.notes || '',
      }))
    );
    setConfirmOpen(true);
  };

  const handleConfirmReceipt = () => {
    const data = {
      items: confirmItems.map((item) => ({
        productId: item.productId,
        quantityReceived: item.quantityReceived,
        notes: item.notes,
      })),
    };

    confirmMutation.mutate({ id: selectedConsignment._id, data });
  };

  const getStatusBadge = (consignment) => {
    const { status, isOld, sapIntegration } = consignment;
    const sapStatus = sapIntegration?.status;

    if (status === 'RECIBIDO') {
      // Show SAP sync status for received consignments
      if (sapStatus === 'FAILED') {
        return (
          <Badge className="bg-red-100 text-red-800 border-0">
            <XCircle className="h-3 w-3 mr-1" />
            SAP Error
          </Badge>
        );
      }
      if (sapStatus === 'SYNCED') {
        return (
          <Badge className="bg-green-100 text-green-800 border-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Recibido
          </Badge>
        );
      }
      // No SAP status yet
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Pendiente SAP
        </Badge>
      );
    }

    if (isOld) {
      return (
        <Badge className="bg-red-100 text-red-800 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          En Tránsito (Retrasado)
        </Badge>
      );
    }

    return (
      <Badge className="bg-blue-100 text-blue-800 border-0">
        <Clock className="h-3 w-3 mr-1" />
        En Tránsito
      </Badge>
    );
  };

  const getOriginBadge = (consignment) => {
    // origin undefined or 'APP' means created in app, 'SAP_IMPORT' means imported
    if (consignment.origin === 'SAP_IMPORT') {
      return (
        <Badge className="bg-purple-100 text-purple-800 border-0">
          <Download className="h-3 w-3 mr-1" />
          Importado SAP
        </Badge>
      );
    }
    return null;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-DO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) return <div>Cargando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Consignaciones</h1>
        <p className="text-muted-foreground">Historial y gestión de consignaciones</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Estado</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="EN_TRANSITO">En Tránsito</SelectItem>
                  <SelectItem value="RECIBIDO">Recibido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Consignments List */}
      <Card>
        <CardHeader>
          <CardTitle>Consignaciones ({consignaciones?.length || 0})</CardTitle>
          <CardDescription>Listado de todas las consignaciones</CardDescription>
        </CardHeader>
        <CardContent>
          {consignaciones && consignaciones.length > 0 ? (
            <div className="space-y-3">
              {consignaciones.map((consignment) => (
                <Card
                  key={consignment._id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleViewConsignment(consignment)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-3">
                          <Truck className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <div className="font-medium">
                              {consignment.fromLocationId?.name} → {consignment.toLocationId?.name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {consignment.items.length} producto{consignment.items.length !== 1 ? 's' : ''} •{' '}
                              {consignment.items.reduce((sum, item) => sum + item.quantitySent, 0)} unidades
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="font-medium">Creado:</span> {formatDate(consignment.createdAt)}
                          </div>
                          <div>
                            <span className="font-medium">Por:</span>{' '}
                            {consignment.createdBy?.firstname} {consignment.createdBy?.lastname}
                          </div>
                          {consignment.status === 'RECIBIDO' && consignment.confirmedAt && (
                            <div>
                              <span className="font-medium">Confirmado:</span> {formatDate(consignment.confirmedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        {getOriginBadge(consignment)}
                        {getStatusBadge(consignment)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No hay consignaciones</p>
              <p className="text-sm text-muted-foreground">
                {statusFilter === 'all'
                  ? 'Crea una consignación desde la página de Planificación'
                  : `No hay consignaciones con estado: ${statusFilter}`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      {selectedConsignment && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedConsignment.status === 'RECIBIDO' ? 'Detalles de Consignación' : 'Confirmar Recepción'}
              </DialogTitle>
              <DialogDescription>
                {selectedConsignment.fromLocationId?.name} → {selectedConsignment.toLocationId?.name}
                <br />
                Creado el {formatDate(selectedConsignment.createdAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2">Producto</th>
                      <th className="text-left p-2">Tamaño</th>
                      <th className="text-right p-2">Enviado</th>
                      {selectedConsignment.status === 'EN_TRANSITO' ? (
                        <th className="text-right p-2">Recibido</th>
                      ) : (
                        <th className="text-right p-2">Recibido</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {confirmItems.map((item, index) => (
                      <tr key={item.productId} className="border-b">
                        <td className="p-2">
                          <div>
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">Código: {item.productCode}</div>
                          </div>
                        </td>
                        <td className="p-2">{item.size}</td>
                        <td className="p-2 text-right font-medium">{item.quantitySent}</td>
                        <td className="p-2">
                          {selectedConsignment.status === 'EN_TRANSITO' ? (
                            <div className="flex justify-end">
                              <Input
                                type="number"
                                min="0"
                                max={item.quantitySent}
                                value={item.quantityReceived}
                                onChange={(e) => {
                                  const newItems = [...confirmItems];
                                  newItems[index].quantityReceived = Math.max(
                                    0,
                                    Math.min(item.quantitySent, parseInt(e.target.value) || 0)
                                  );
                                  setConfirmItems(newItems);
                                }}
                                className="w-20 text-right"
                              />
                            </div>
                          ) : (
                            <div className="text-right font-medium text-green-600">{item.quantityReceived}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedConsignment.status === 'EN_TRANSITO' && (
                <div className="bg-blue-50 p-3 rounded-md text-sm">
                  <p className="font-medium text-blue-900 mb-1">Nota:</p>
                  <p className="text-blue-700">
                    Ajusta las cantidades recibidas si hay diferencias. Las cantidades no recibidas se devolverán
                    automáticamente al almacén.
                  </p>
                </div>
              )}

              {/* SAP Sync Status */}
              {selectedConsignment.status === 'RECIBIDO' && selectedConsignment.sapIntegration?.status === 'FAILED' && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-md text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <p className="font-medium text-red-900">Error de sincronización SAP</p>
                  </div>
                  <p className="text-red-700 mb-3 font-mono text-xs bg-red-100 p-2 rounded">
                    {selectedConsignment.sapIntegration?.error || 'Error desconocido'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retrySapMutation.mutate(selectedConsignment._id)}
                    disabled={retrySapMutation.isPending}
                    className="border-red-300 text-red-700 hover:bg-red-100"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${retrySapMutation.isPending ? 'animate-spin' : ''}`} />
                    {retrySapMutation.isPending ? 'Reintentando...' : 'Reintentar SAP'}
                  </Button>
                </div>
              )}

              {selectedConsignment.status === 'RECIBIDO' && selectedConsignment.sapIntegration?.status === 'SYNCED' && (
                <div className="bg-green-50 border border-green-200 p-3 rounded-md text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <p className="font-medium text-green-900">Sincronizado con SAP</p>
                    {selectedConsignment.sapIntegration?.docNum && (
                      <Badge variant="outline" className="ml-2">DocNum: {selectedConsignment.sapIntegration.docNum}</Badge>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-muted/50 p-3 rounded-md">
                <div className="flex justify-between text-sm font-medium mb-1">
                  <span>Total enviado:</span>
                  <span>{confirmItems.reduce((sum, i) => sum + i.quantitySent, 0)} unidades</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span>Total recibido:</span>
                  <span className="text-green-600">
                    {confirmItems.reduce((sum, i) => sum + i.quantityReceived, 0)} unidades
                  </span>
                </div>
                {selectedConsignment.status === 'EN_TRANSITO' &&
                  confirmItems.some((i) => i.quantityReceived < i.quantitySent) && (
                    <div className="flex justify-between text-sm font-medium text-red-600 mt-1">
                      <span>Diferencia (devolver):</span>
                      <span>
                        {confirmItems.reduce((sum, i) => sum + (i.quantitySent - i.quantityReceived), 0)} unidades
                      </span>
                    </div>
                  )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {selectedConsignment.status === 'RECIBIDO' ? 'Cerrar' : 'Cancelar'}
              </Button>
              {selectedConsignment.status === 'EN_TRANSITO' && (
                <Button onClick={handleConfirmReceipt} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending ? 'Confirmando...' : 'Confirmar Recepción'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
