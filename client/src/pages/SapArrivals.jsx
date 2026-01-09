import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sapApi, locacionesApi, productosApi, transaccionesApi } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RefreshCw, Download, Package, Calendar, Check, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function SapArrivals() {
  const [selectedSupplier, setSelectedSupplier] = useState('P00031');
  const [sinceDate, setSinceDate] = useState(() => {
    // Default to 30 days ago
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedArrival, setSelectedArrival] = useState(null);
  const [importedArrivals, setImportedArrivals] = useState({});
  const queryClient = useQueryClient();
  const toast = useToast();

  // Query SAP connection status
  const { data: connectionStatus, isLoading: testingConnection, error: connectionError } = useQuery({
    queryKey: ['sap-connection'],
    queryFn: () => sapApi.testConnection().then((res) => res.data),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  // Query SAP arrivals
  const { data: arrivalsData, isLoading: loadingArrivals, error: arrivalsError, refetch: refetchArrivals } = useQuery({
    queryKey: ['sap-arrivals', selectedSupplier, sinceDate],
    queryFn: () => sapApi.getArrivals({
      supplier: selectedSupplier === 'all' ? undefined : selectedSupplier,
      since: sinceDate
    }).then((res) => res.data),
    enabled: connectionStatus?.success === true,
    retry: false,
  });

  // Handle search button click
  const handleSearch = async () => {
    console.log('handleSearch clicked, connectionStatus:', connectionStatus);
    if (!connectionStatus?.success) {
      toast.error('No hay conexion con SAP. Verifique la configuracion.');
      return;
    }
    try {
      console.log('Calling refetchArrivals...');
      const result = await refetchArrivals();
      console.log('refetchArrivals result:', result);
      console.log('refetchArrivals data:', result.data);
      if (result.data?.arrivals?.length === 0) {
        toast.info('No se encontraron llegadas para los filtros seleccionados');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(`Error buscando en SAP: ${error.message}`);
    }
  };

  // Query warehouse location
  const { data: locations } = useQuery({
    queryKey: ['locaciones'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  // Query products (for matching)
  const { data: products } = useQuery({
    queryKey: ['productos'],
    queryFn: () => productosApi.getAll().then((res) => res.data),
  });

  // Import mutation (warehouse receipt)
  const importMutation = useMutation({
    mutationFn: async (arrivalItem) => {
      const warehouseLocation = locations?.find(loc => loc.type === 'WAREHOUSE');
      if (!warehouseLocation) throw new Error('No warehouse location found');

      // Find matching product by SAP item code
      const product = products?.find(p => p.sapItemCode === arrivalItem.itemCode);
      if (!product) throw new Error(`No matching product for SAP item code: ${arrivalItem.itemCode}`);

      // Create warehouse receipt for each batch
      const receipts = [];
      for (const batch of arrivalItem.batches) {
        const receiptData = {
          productId: product._id,
          locationId: warehouseLocation._id,
          quantity: batch.quantity,
          lotNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          supplier: arrivalItem.supplierName,
          notes: `SAP Doc: ${arrivalItem.sapDocNum} | Imported from SAP`,
        };
        const result = await transaccionesApi.warehouseReceipt(receiptData);
        receipts.push(result.data);
      }
      return receipts;
    },
    onSuccess: (_, arrivalItem) => {
      queryClient.invalidateQueries(['inventario']);
      setImportedArrivals(prev => ({
        ...prev,
        [`${arrivalItem.sapDocNum}-${arrivalItem.itemCode}`]: true,
      }));
      toast.success(`Producto importado: ${arrivalItem.itemName}`);
      setImportDialogOpen(false);
      setSelectedArrival(null);
    },
    onError: (error) => {
      console.error('Import error:', error);
      toast.error(`Error al importar: ${error.message}`);
    },
  });

  const handleImport = (arrival) => {
    setSelectedArrival(arrival);
    setImportDialogOpen(true);
  };

  const confirmImport = () => {
    if (selectedArrival) {
      importMutation.mutate(selectedArrival);
    }
  };

  const warehouseLocation = locations?.find(loc => loc.type === 'WAREHOUSE');
  const arrivals = arrivalsData?.arrivals || [];
  const trackedSuppliers = arrivalsData?.trackedSuppliers || [];

  // Check if product exists in our system
  const getProductMatch = (itemCode) => {
    const product = products?.find(p => p.sapItemCode === itemCode);
    return product;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sincronizar Llegadas de SAP</h1>
        <p className="text-muted-foreground">
          Importar entradas de mercancia desde SAP Business One
        </p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Estado de Conexion SAP</CardTitle>
              <CardDescription>
                {testingConnection
                  ? 'Verificando conexion...'
                  : connectionStatus?.success
                  ? 'Conectado a SAP Business One'
                  : connectionError
                  ? `Error: ${connectionError.response?.data?.message || connectionError.message}`
                  : connectionStatus?.message || 'No conectado'}
              </CardDescription>
            </div>
            <Badge variant={connectionStatus?.success ? 'success' : 'destructive'}>
              {testingConnection ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : connectionStatus?.success ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 mr-1" />
              )}
              {connectionStatus?.success ? 'Conectado' : 'Desconectado'}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros de Busqueda</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Proveedor</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {trackedSuppliers.map((supplier) => (
                    <SelectItem key={supplier.cardCode} value={supplier.cardCode}>
                      {supplier.cardName}
                    </SelectItem>
                  ))}
                  <SelectItem value="all">Todos los proveedores</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Desde fecha</Label>
              <Input
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>&nbsp;</Label>
              <Button
                onClick={handleSearch}
                disabled={loadingArrivals || testingConnection}
              >
                {loadingArrivals ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Buscar en SAP
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle>Llegadas Encontradas ({arrivals.length})</CardTitle>
          <CardDescription>
            Entradas de mercancia desde SAP. Selecciona los productos a importar al inventario.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connectionError && (
            <div className="flex items-center justify-center py-8 text-red-600">
              <AlertCircle className="h-6 w-6 mr-2" />
              Error de conexion: {connectionError.message}
            </div>
          )}
          {arrivalsError && (
            <div className="flex items-center justify-center py-8 text-red-600">
              <AlertCircle className="h-6 w-6 mr-2" />
              Error buscando llegadas: {arrivalsError.message}
            </div>
          )}
          {loadingArrivals ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Buscando en SAP...
            </div>
          ) : !connectionError && !arrivalsError && arrivals.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No se encontraron llegadas en el periodo seleccionado</p>
            </div>
          ) : (
            <div className="space-y-4">
              {arrivals.map((arrival, index) => {
                const key = `${arrival.sapDocNum}-${arrival.itemCode}`;
                const isImported = importedArrivals[key];
                const matchedProduct = getProductMatch(arrival.itemCode);

                return (
                  <div
                    key={key}
                    className={`border rounded-lg p-4 ${
                      isImported ? 'bg-green-50 border-green-200' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{arrival.itemName}</span>
                          {isImported && (
                            <Badge variant="success" className="bg-green-100 text-green-800">
                              <Check className="h-3 w-3 mr-1" />
                              Importado
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-4">
                            <span>Codigo SAP: {arrival.itemCode}</span>
                            <span>Doc: {arrival.sapDocNum}</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(arrival.docDate).toLocaleDateString()}
                            </span>
                          </div>
                          <div>
                            Proveedor: {arrival.supplierName} | Almacen SAP: {arrival.warehouseCode}
                          </div>
                          {matchedProduct ? (
                            <div className="text-green-600">
                              Producto local: {matchedProduct.name} ({matchedProduct.code})
                            </div>
                          ) : (
                            <div className="text-orange-600">
                              Sin producto asociado en el sistema
                            </div>
                          )}
                        </div>

                        {/* Batches */}
                        <div className="mt-3">
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            Lotes ({arrival.batches.length}):
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {arrival.batches.map((batch, bIndex) => (
                              <Badge
                                key={bIndex}
                                variant="outline"
                                className="text-xs"
                              >
                                {batch.batchNumber}: {batch.quantity} uds
                                {batch.expiryDate && (
                                  <span className="ml-1 text-muted-foreground">
                                    (exp: {new Date(batch.expiryDate).toLocaleDateString()})
                                  </span>
                                )}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <div className="text-right mr-2">
                          <div className="text-lg font-bold">{arrival.totalQuantity}</div>
                          <div className="text-xs text-muted-foreground">unidades</div>
                        </div>
                        <Button
                          onClick={() => handleImport(arrival)}
                          disabled={isImported || !matchedProduct}
                          variant={isImported ? 'outline' : 'default'}
                          size="sm"
                        >
                          {isImported ? (
                            <>
                              <Check className="h-4 w-4 mr-1" />
                              Importado
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-1" />
                              Importar
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Confirmation Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Importacion</DialogTitle>
            <DialogDescription>
              Se creara una entrada de inventario en el almacen para este producto.
            </DialogDescription>
          </DialogHeader>

          {selectedArrival && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="font-medium mb-2">{selectedArrival.itemName}</div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Codigo SAP: {selectedArrival.itemCode}</div>
                  <div>Proveedor: {selectedArrival.supplierName}</div>
                  <div>Documento: {selectedArrival.sapDocNum}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Lotes a importar:</div>
                <div className="space-y-2">
                  {selectedArrival.batches.map((batch, index) => (
                    <div
                      key={index}
                      className="flex justify-between items-center border rounded p-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{batch.batchNumber}</span>
                        {batch.expiryDate && (
                          <span className="text-muted-foreground ml-2">
                            Exp: {new Date(batch.expiryDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary">{batch.quantity} uds</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <span className="font-medium">Total:</span>
                <span className="text-lg font-bold text-blue-600">
                  {selectedArrival.totalQuantity} unidades
                </span>
              </div>

              <div className="text-sm text-muted-foreground">
                Destino: {warehouseLocation?.name || 'Almacen Principal'}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(false)}
              disabled={importMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmImport}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Confirmar Importacion
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
