import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reconciliationApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, FileText, Package, ChevronDown, ChevronUp, Calendar, Settings } from 'lucide-react';
import { useToast } from '../components/ui/toast';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// Date source labels
const DATE_SOURCE_LABELS = {
  LAST_RUN: 'Desde última verificación',
  GO_LIVE_DATE: 'Desde fecha de inicio',
  CUSTOM_RANGE: 'Rango personalizado',
  NONE: 'Sin configurar',
};

// Document type labels in Spanish
const DOC_TYPE_LABELS = {
  PurchaseDeliveryNote: 'Entrada de Mercancía',
  StockTransfer: 'Traslado de Stock',
  DeliveryNote: 'Entrega (Consumo)',
};

// Status badges
const STATUS_BADGES = {
  PENDING_REVIEW: { label: 'Pendiente', variant: 'warning' },
  ACKNOWLEDGED: { label: 'Reconocido', variant: 'default' },
  IMPORTED: { label: 'Importado', variant: 'success' },
  IGNORED: { label: 'Ignorado', variant: 'secondary' },
};

// Run status badges
const RUN_STATUS_BADGES = {
  RUNNING: { label: 'En progreso', variant: 'warning', icon: RefreshCw },
  COMPLETED: { label: 'Completado', variant: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Fallido', variant: 'destructive', icon: AlertTriangle },
};

export default function Reconciliation() {
  const [expandedDoc, setExpandedDoc] = useState(null);
  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  const [selectedAction, setSelectedAction] = useState(null);
  const [customDateDialogOpen, setCustomDateDialogOpen] = useState(false);
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();

  // Get reconciliation config (goLiveDate)
  const { data: config } = useQuery({
    queryKey: ['reconciliation-config'],
    queryFn: () => reconciliationApi.getConfig().then((res) => res.data),
  });

  // Get reconciliation status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['reconciliation-status'],
    queryFn: () => reconciliationApi.getStatus().then((res) => res.data),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Get external documents
  const { data: externalDocs, isLoading: docsLoading } = useQuery({
    queryKey: ['external-documents', statusFilter],
    queryFn: () => reconciliationApi.getExternalDocuments({ status: statusFilter === 'ALL' ? null : statusFilter }).then((res) => res.data),
  });

  // Get run history
  const { data: runHistory } = useQuery({
    queryKey: ['reconciliation-runs'],
    queryFn: () => reconciliationApi.getRunHistory(5).then((res) => res.data),
  });

  // Trigger reconciliation
  const runMutation = useMutation({
    mutationFn: (options = {}) => reconciliationApi.run(options),
    onSuccess: (result) => {
      queryClient.invalidateQueries(['reconciliation-status']);
      queryClient.invalidateQueries(['external-documents']);
      queryClient.invalidateQueries(['reconciliation-runs']);
      setCustomDateDialogOpen(false);
      setCustomFromDate('');
      setCustomToDate('');
      const found = result.data?.stats?.externalDocsFound || 0;
      if (found > 0) {
        toast.warning(`Reconciliación completada. Se encontraron ${found} documentos externos.`);
      } else {
        toast.success('Reconciliación completada. No se encontraron documentos externos.');
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al ejecutar reconciliación');
    },
  });

  // Run with default date window (moving window)
  const handleRunDefault = () => {
    runMutation.mutate({});
  };

  // Run with custom date range
  const handleRunCustom = () => {
    const options = {};
    if (customFromDate) options.fromDate = customFromDate;
    if (customToDate) options.toDate = customToDate;
    runMutation.mutate(options);
  };

  // Update document status
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, notes }) => reconciliationApi.updateDocumentStatus(id, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries(['reconciliation-status']);
      queryClient.invalidateQueries(['external-documents']);
      setActionDialogOpen(false);
      setSelectedDoc(null);
      setActionNotes('');
      setSelectedAction(null);
      toast.success('Estado actualizado correctamente');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al actualizar estado');
    },
  });

  const handleAction = (doc, action) => {
    setSelectedDoc(doc);
    setSelectedAction(action);
    setActionDialogOpen(true);
  };

  const confirmAction = () => {
    if (selectedDoc && selectedAction) {
      updateStatusMutation.mutate({
        id: selectedDoc._id,
        status: selectedAction,
        notes: actionNotes,
      });
    }
  };

  const latestRun = status?.latestRun;
  const pendingCount = status?.pendingDocumentsCount || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliación SAP</h1>
          <p className="text-muted-foreground">
            Detecta documentos creados en SAP que no fueron registrados por esta aplicación
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCustomDateDialogOpen(true)}
            disabled={runMutation.isPending || status?.latestRun?.status === 'RUNNING' || !config?.isConfigured}
          >
            <Calendar className="mr-2 h-4 w-4" />
            Rango Personalizado
          </Button>
          <Button
            onClick={handleRunDefault}
            disabled={runMutation.isPending || status?.latestRun?.status === 'RUNNING' || !config?.isConfigured}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${runMutation.isPending ? 'animate-spin' : ''}`} />
            Verificar Ahora
          </Button>
        </div>
      </div>

      {/* Config Warning */}
      {config && !config.isConfigured && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">
                  Reconciliación no configurada
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  Ejecuta el script de sincronización inicial (<code className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">sync-inventory-from-sap.js</code>) para establecer la fecha de inicio de reconciliación.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Last Run Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Última Verificación
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="text-sm text-muted-foreground">Cargando...</div>
            ) : latestRun ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {RUN_STATUS_BADGES[latestRun.status] && (
                    <>
                      {(() => {
                        const Icon = RUN_STATUS_BADGES[latestRun.status].icon;
                        return <Icon className="h-4 w-4" />;
                      })()}
                      <Badge variant={RUN_STATUS_BADGES[latestRun.status].variant}>
                        {RUN_STATUS_BADGES[latestRun.status].label}
                      </Badge>
                    </>
                  )}
                </div>
                <div className="text-2xl font-bold">
                  {formatDistanceToNow(new Date(latestRun.startedAt), { addSuffix: true, locale: es })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(latestRun.startedAt), 'PPpp', { locale: es })}
                </p>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Nunca ejecutada</div>
            )}
          </CardContent>
        </Card>

        {/* Pending Documents Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documentos Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {pendingCount > 0 ? (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              <span className="text-3xl font-bold">{pendingCount}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {pendingCount > 0
                ? 'Requieren revisión'
                : 'Todo sincronizado'}
            </p>
          </CardContent>
        </Card>

        {/* Documents Checked Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documentos Analizados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestRun?.stats ? (
              <>
                <div className="text-3xl font-bold">
                  {latestRun.stats.totalDocumentsChecked}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {DATE_SOURCE_LABELS[latestRun.config?.dateSource] || 'Rango desconocido'}
                </p>
                {latestRun.config?.fromDate && (
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(latestRun.config.fromDate), 'dd/MM/yyyy HH:mm')} → {format(new Date(latestRun.config.toDate), 'dd/MM/yyyy HH:mm')}
                  </p>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">-</div>
            )}
          </CardContent>
        </Card>

        {/* Config Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-1">
                <Settings className="h-3 w-3" />
                Configuración
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {config?.isConfigured ? (
              <>
                <div className="text-sm font-medium text-green-600">Activa</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Fecha inicio: {format(new Date(config.goLiveDate), 'PPP', { locale: es })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {config.goLiveDateSetBy?.type === 'SYNC_SCRIPT' ? 'Configurado por sync' : 'Configurado manualmente'}
                </p>
              </>
            ) : (
              <div className="text-sm text-yellow-600">Sin configurar</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* External Documents Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Documentos Externos</CardTitle>
              <CardDescription>
                Documentos de SAP que no fueron creados por esta aplicación
              </CardDescription>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                <SelectItem value="PENDING_REVIEW">Pendientes</SelectItem>
                <SelectItem value="ACKNOWLEDGED">Reconocidos</SelectItem>
                <SelectItem value="IMPORTED">Importados</SelectItem>
                <SelectItem value="IGNORED">Ignorados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {docsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando documentos...</div>
          ) : !externalDocs || externalDocs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <p>No hay documentos externos {statusFilter !== 'ALL' ? `con estado "${STATUS_BADGES[statusFilter]?.label}"` : ''}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {externalDocs.map((doc) => (
                <div
                  key={doc._id}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground mt-1" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {DOC_TYPE_LABELS[doc.sapDocType] || doc.sapDocType}
                          </span>
                          <Badge variant="outline">#{doc.sapDocNum}</Badge>
                          <Badge variant={STATUS_BADGES[doc.status]?.variant || 'default'}>
                            {STATUS_BADGES[doc.status]?.label || doc.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Fecha SAP: {format(new Date(doc.sapDocDate), 'PPP', { locale: es })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Detectado: {formatDistanceToNow(new Date(doc.detectedAt), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.status === 'PENDING_REVIEW' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAction(doc, 'ACKNOWLEDGED')}
                          >
                            Reconocer
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAction(doc, 'IGNORED')}
                          >
                            Ignorar
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedDoc(expandedDoc === doc._id ? null : doc._id)}
                      >
                        {expandedDoc === doc._id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedDoc === doc._id && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-sm font-medium mb-2">Productos afectados:</h4>
                      <div className="space-y-2">
                        {doc.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm bg-muted/50 rounded p-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono">{item.sapItemCode}</span>
                            <span className="text-muted-foreground">-</span>
                            <span>{item.productName || 'Producto no vinculado'}</span>
                            <Badge variant="secondary" className="ml-auto">
                              {item.quantity} uds
                            </Badge>
                            {item.batchNumber && (
                              <span className="text-xs text-muted-foreground">
                                Lote: {item.batchNumber}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {doc.notes && (
                        <div className="mt-3 p-2 bg-muted rounded text-sm">
                          <strong>Notas:</strong> {doc.notes}
                        </div>
                      )}
                      {doc.reviewedBy && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Revisado por {doc.reviewedBy.firstname} {doc.reviewedBy.lastname} el{' '}
                          {format(new Date(doc.reviewedAt), 'PPp', { locale: es })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run History */}
      {runHistory && runHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historial de Verificaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {runHistory.map((run) => (
                <div
                  key={run.runId}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {format(new Date(run.startedAt), 'PPp', { locale: es })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.runType === 'NIGHTLY' ? 'Automática' : 'Manual'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant={RUN_STATUS_BADGES[run.status]?.variant || 'default'}>
                      {RUN_STATUS_BADGES[run.status]?.label || run.status}
                    </Badge>
                    <div className="text-right">
                      <p className="text-sm font-medium">{run.stats?.totalDocumentsChecked || 0} docs</p>
                      <p className="text-xs text-muted-foreground">
                        {run.stats?.externalDocsFound || 0} externos
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedAction === 'ACKNOWLEDGED' ? 'Reconocer Documento' : 'Ignorar Documento'}
            </DialogTitle>
            <DialogDescription>
              {selectedAction === 'ACKNOWLEDGED'
                ? 'Marcar este documento como reconocido. Esto indica que lo has revisado pero no lo importarás al sistema.'
                : 'Ignorar este documento. Úsalo para documentos de prueba o que no afectan tu inventario.'}
            </DialogDescription>
          </DialogHeader>
          {selectedDoc && (
            <div className="py-4">
              <div className="bg-muted rounded p-3 mb-4">
                <p className="font-medium">{DOC_TYPE_LABELS[selectedDoc.sapDocType]} #{selectedDoc.sapDocNum}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedDoc.items?.length || 0} productos afectados
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notas (opcional)</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Añade una nota explicando tu decisión..."
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={confirmAction}
              disabled={updateStatusMutation.isPending}
              variant={selectedAction === 'IGNORED' ? 'secondary' : 'default'}
            >
              {updateStatusMutation.isPending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Date Range Dialog */}
      <Dialog open={customDateDialogOpen} onOpenChange={setCustomDateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verificar Rango Personalizado</DialogTitle>
            <DialogDescription>
              Selecciona el rango de fechas para buscar documentos externos en SAP.
              Deja en blanco para usar el rango automático.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Desde</label>
              <input
                type="datetime-local"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Dejar vacío para usar desde la última verificación o fecha de inicio
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Hasta</label>
              <input
                type="datetime-local"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Dejar vacío para usar hasta ahora
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleRunCustom}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Verificando...
                </>
              ) : (
                'Verificar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
