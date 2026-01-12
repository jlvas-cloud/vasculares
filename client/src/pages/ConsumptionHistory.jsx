import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { consumptionApi, locacionesApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  Stethoscope,
  FileText,
} from 'lucide-react';
import { useToast } from '../components/ui/toast';
import { formatDate, formatDateTime } from '../lib/utils';

export default function ConsumptionHistory() {
  const [selectedCentro, setSelectedCentro] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedConsumo, setSelectedConsumo] = useState(null);

  const queryClient = useQueryClient();
  const toast = useToast();

  // Query Centros for filter
  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const centros = allLocations?.filter((loc) => loc.type === 'CENTRO') || [];

  // Query consumption history
  const { data: historyData, isLoading } = useQuery({
    queryKey: ['consumption-history', selectedCentro, startDate, endDate],
    queryFn: () =>
      consumptionApi
        .getHistory({
          centroId: selectedCentro && selectedCentro !== 'all' ? selectedCentro : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          limit: 100,
        })
        .then((res) => res.data),
  });

  // Retry SAP mutation
  const retrySapMutation = useMutation({
    mutationFn: (id) => consumptionApi.retrySap(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['consumption-history']);
      if (response.data.success) {
        toast.success('Sincronizado con SAP exitosamente');
      } else {
        toast.error(`Error SAP: ${response.data.error}`);
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al reintentar SAP');
    },
  });

  const consumos = historyData?.consumos || [];

  const getStatusBadge = (consumo) => {
    if (consumo.status === 'SYNCED' || consumo.sapSync?.pushed) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Sincronizado
        </Badge>
      );
    }
    if (consumo.status === 'FAILED') {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700">
          <XCircle className="h-3 w-3 mr-1" />
          Error SAP
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
        <AlertCircle className="h-3 w-3 mr-1" />
        Pendiente
      </Badge>
    );
  };

  const handleRowClick = (consumo) => {
    if (expandedId === consumo._id) {
      setExpandedId(null);
    } else {
      setExpandedId(consumo._id);
    }
  };

  const handleViewDetails = (consumo) => {
    setSelectedConsumo(consumo);
    setDetailDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historial de Consumos</h1>
        <p className="text-muted-foreground">
          Ver y gestionar consumos registrados en los Centros
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-2">
              <Label>Centro</Label>
              <Select value={selectedCentro} onValueChange={setSelectedCentro}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los centros" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los centros</SelectItem>
                  {centros.map((centro) => (
                    <SelectItem key={centro._id} value={centro._id}>
                      {centro.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Desde</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Hasta</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedCentro('all');
                  setStartDate('');
                  setEndDate('');
                }}
              >
                Limpiar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Consumos ({historyData?.total || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : consumos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay consumos registrados
            </div>
          ) : (
            <div className="space-y-2">
              {consumos.map((consumo) => (
                <div key={consumo._id} className="border rounded-lg">
                  {/* Row Header */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(consumo)}
                  >
                    <div className="text-muted-foreground">
                      {expandedId === consumo._id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 grid gap-1 md:grid-cols-6 items-center">
                      <div className="md:col-span-2">
                        <div className="font-medium">{consumo.centroName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(consumo.createdAt)}
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Items: </span>
                        <span className="font-medium">{consumo.totalItems || consumo.items?.length}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Cant: </span>
                        <span className="font-medium">{consumo.totalQuantity}</span>
                      </div>
                      <div>{getStatusBadge(consumo)}</div>
                      <div className="flex justify-end gap-2">
                        {consumo.status === 'FAILED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              retrySapMutation.mutate(consumo._id);
                            }}
                            disabled={retrySapMutation.isPending}
                          >
                            <RefreshCw className={`h-3 w-3 mr-1 ${retrySapMutation.isPending ? 'animate-spin' : ''}`} />
                            Reintentar
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetails(consumo);
                          }}
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          Detalle
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedId === consumo._id && (
                    <div className="border-t bg-muted/30 p-4">
                      <div className="grid gap-4 md:grid-cols-2 mb-4">
                        {consumo.patientName && (
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Paciente:</span>
                            <span>{consumo.patientName}</span>
                          </div>
                        )}
                        {consumo.doctorName && (
                          <div className="flex items-center gap-2 text-sm">
                            <Stethoscope className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Doctor:</span>
                            <span>{consumo.doctorName}</span>
                          </div>
                        )}
                        {consumo.procedureDate && (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Fecha Proc.:</span>
                            <span>{formatDate(consumo.procedureDate)}</span>
                          </div>
                        )}
                        {consumo.procedureType && (
                          <div className="flex items-center gap-2 text-sm">
                            <Activity className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Tipo:</span>
                            <span>{consumo.procedureType}</span>
                          </div>
                        )}
                      </div>

                      {/* Items Table */}
                      <div className="border rounded-lg overflow-hidden bg-background">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Producto</th>
                              <th className="px-3 py-2 text-left font-medium">Lote</th>
                              <th className="px-3 py-2 text-center font-medium">Cant</th>
                            </tr>
                          </thead>
                          <tbody>
                            {consumo.items?.map((item, idx) => (
                              <tr key={idx} className="border-t">
                                <td className="px-3 py-2">
                                  <div className="font-medium">{item.productName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    SAP: {item.sapItemCode}
                                  </div>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {item.lotNumber}
                                </td>
                                <td className="px-3 py-2 text-center font-medium">
                                  {item.quantity}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* SAP Info */}
                      {consumo.sapSync?.pushed && (
                        <div className="mt-4 p-3 bg-green-50 rounded-lg text-sm">
                          <div className="flex items-center gap-2 text-green-700 font-medium mb-1">
                            <CheckCircle2 className="h-4 w-4" />
                            SAP DeliveryNote
                          </div>
                          <div className="text-green-600 space-x-4">
                            <span>Doc Entry: {consumo.sapSync.sapDocEntry}</span>
                            <span>Doc Num: {consumo.sapSync.sapDocNum}</span>
                          </div>
                        </div>
                      )}

                      {consumo.sapSync?.error && (
                        <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm">
                          <div className="flex items-center gap-2 text-red-700 font-medium mb-1">
                            <XCircle className="h-4 w-4" />
                            Error SAP
                          </div>
                          <div className="text-red-600">{consumo.sapSync.error}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de Consumo</DialogTitle>
            <DialogDescription>
              {selectedConsumo?.centroName} - {formatDateTime(selectedConsumo?.createdAt)}
            </DialogDescription>
          </DialogHeader>

          {selectedConsumo && (
            <div className="space-y-4">
              {/* Meta Info */}
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                {selectedConsumo.patientName && (
                  <div>
                    <span className="text-muted-foreground">Paciente: </span>
                    <span className="font-medium">{selectedConsumo.patientName}</span>
                  </div>
                )}
                {selectedConsumo.doctorName && (
                  <div>
                    <span className="text-muted-foreground">Doctor: </span>
                    <span className="font-medium">{selectedConsumo.doctorName}</span>
                  </div>
                )}
                {selectedConsumo.procedureDate && (
                  <div>
                    <span className="text-muted-foreground">Fecha Procedimiento: </span>
                    <span className="font-medium">{formatDate(selectedConsumo.procedureDate)}</span>
                  </div>
                )}
                {selectedConsumo.procedureType && (
                  <div>
                    <span className="text-muted-foreground">Tipo: </span>
                    <span className="font-medium">{selectedConsumo.procedureType}</span>
                  </div>
                )}
                {selectedConsumo.notes && (
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground">Notas: </span>
                    <span>{selectedConsumo.notes}</span>
                  </div>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Estado:</span>
                {getStatusBadge(selectedConsumo)}
              </div>

              {/* Items */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Producto</th>
                      <th className="px-3 py-2 text-left font-medium">SAP Code</th>
                      <th className="px-3 py-2 text-left font-medium">Lote</th>
                      <th className="px-3 py-2 text-center font-medium">Cant</th>
                      <th className="px-3 py-2 text-right font-medium">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedConsumo.items?.map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 font-medium">{item.productName}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.sapItemCode}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.lotNumber}</td>
                        <td className="px-3 py-2 text-center">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">
                          {item.price ? `${item.currency || 'USD'} ${item.price.toFixed(2)}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan="3" className="px-3 py-2 font-medium text-right">Total:</td>
                      <td className="px-3 py-2 text-center font-medium">
                        {selectedConsumo.totalQuantity}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {selectedConsumo.totalValue
                          ? `USD ${selectedConsumo.totalValue.toFixed(2)}`
                          : '-'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* SAP Info */}
              {selectedConsumo.sapSync?.pushed && (
                <div className="p-4 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Sincronizado con SAP
                  </div>
                  <div className="grid gap-2 text-sm text-green-600">
                    <div>
                      <span className="text-muted-foreground">Tipo Documento: </span>
                      <span>Entrega (DeliveryNote)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Entry: </span>
                      <span className="font-mono">{selectedConsumo.sapSync.sapDocEntry}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Num: </span>
                      <Badge variant="secondary">{selectedConsumo.sapSync.sapDocNum}</Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sincronizado: </span>
                      <span>{formatDateTime(selectedConsumo.sapSync.pushedAt)}</span>
                    </div>
                  </div>
                </div>
              )}

              {selectedConsumo.sapSync?.error && !selectedConsumo.sapSync?.pushed && (
                <div className="p-4 bg-red-50 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                    <XCircle className="h-4 w-4" />
                    Error de Sincronizacion SAP
                  </div>
                  <div className="text-sm text-red-600 mb-3">{selectedConsumo.sapSync.error}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      retrySapMutation.mutate(selectedConsumo._id);
                      setDetailDialogOpen(false);
                    }}
                    disabled={retrySapMutation.isPending}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${retrySapMutation.isPending ? 'animate-spin' : ''}`} />
                    Reintentar Sincronizacion
                  </Button>
                </div>
              )}

              {/* Created By */}
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Registrado por: {selectedConsumo.createdBy?.firstname} {selectedConsumo.createdBy?.lastname}
                {' - '}
                {formatDateTime(selectedConsumo.createdAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
