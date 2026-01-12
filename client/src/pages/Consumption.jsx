import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { locacionesApi, consumptionApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Activity, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Edit3, FileUp, Package } from 'lucide-react';
import { useToast } from '../components/ui/toast';
import { formatDate } from '../lib/utils';
import FileUploader from '../components/FileUploader';

export default function Consumption() {
  // Tab state
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'document'

  // Centro selection
  const [selectedCentro, setSelectedCentro] = useState('');

  // Manual entry state
  const [manualItems, setManualItems] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedLot, setSelectedLot] = useState('');
  const [quantity, setQuantity] = useState(1);

  // Document extraction state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [extractedItems, setExtractedItems] = useState([]);
  const [extractionWarnings, setExtractionWarnings] = useState([]);

  // Optional fields
  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [procedureDate, setProcedureDate] = useState('');
  const [procedureType, setProcedureType] = useState('');
  const [notes, setNotes] = useState('');

  // Result dialog
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [consumptionResult, setConsumptionResult] = useState(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  // Query Centros
  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locacionesApi.getAll({ active: true }).then((res) => res.data),
  });

  const centros = useMemo(() => {
    return allLocations?.filter((loc) => loc.type === 'CENTRO') || [];
  }, [allLocations]);

  // Get selected centro data
  const selectedCentroData = useMemo(() => {
    return centros.find((c) => c._id === selectedCentro);
  }, [centros, selectedCentro]);

  // Query available inventory at selected Centro
  const { data: inventoryData, isLoading: loadingInventory } = useQuery({
    queryKey: ['consumption-inventory', selectedCentro],
    queryFn: () => consumptionApi.getInventory(selectedCentro).then((res) => res.data),
    enabled: !!selectedCentro,
  });

  // Get available products from inventory
  const availableProducts = useMemo(() => {
    return inventoryData?.items || [];
  }, [inventoryData]);

  // Get selected product data
  const selectedProductData = useMemo(() => {
    return availableProducts.find((p) => p.productId === selectedProduct);
  }, [availableProducts, selectedProduct]);

  // Get available lots for selected product
  const availableLots = useMemo(() => {
    return selectedProductData?.lots || [];
  }, [selectedProductData]);

  // Get selected lot data
  const selectedLotData = useMemo(() => {
    return availableLots.find((l) => l.loteId === selectedLot);
  }, [availableLots, selectedLot]);

  // Extraction mutation
  const extractMutation = useMutation({
    mutationFn: (files) => consumptionApi.extract(files, selectedCentro),
    onSuccess: (response) => {
      const data = response.data;
      if (data.success && data.items?.length > 0) {
        // Convert extracted items to form items format
        const formItems = data.items.map((item, idx) => ({
          id: Date.now() + idx,
          code: item.code,
          name: item.name || item.matchedProductName,
          productId: item.matchedProductId,
          productName: item.matchedProductName,
          sapItemCode: item.sapItemCode,
          loteId: item.matchedLoteId,
          lotNumber: item.matchedLotNumber || item.lotNumber,
          quantity: item.quantity || 1,
          availableLots: item.availableLots || [],
          needsLotSelection: item.needsLotSelection,
          price: item.price,
          currency: item.currency,
        }));
        setExtractedItems(formItems);
        setExtractionWarnings(data.warnings || []);
        toast.success(`${formItems.length} items extraidos`);
      } else {
        toast.error('No se encontraron items en los documentos');
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al extraer datos');
    },
  });

  // Create consumption mutation
  const createMutation = useMutation({
    mutationFn: (data) => consumptionApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries(['inventario']);
      queryClient.invalidateQueries(['lotes']);
      queryClient.invalidateQueries(['dashboard-stats']);
      queryClient.invalidateQueries(['consumption-inventory']);
      setConsumptionResult(response.data);
      setResultDialogOpen(true);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al registrar consumo');
    },
  });

  // Handle adding item in manual mode
  const handleAddManualItem = () => {
    if (!selectedLot || quantity < 1) {
      toast.error('Selecciona un lote y cantidad');
      return;
    }

    if (selectedLotData && quantity > selectedLotData.quantityAvailable) {
      toast.error(`Cantidad maxima disponible: ${selectedLotData.quantityAvailable}`);
      return;
    }

    // Check if this lot is already in the list
    const existingIndex = manualItems.findIndex((item) => item.loteId === selectedLot);
    if (existingIndex >= 0) {
      // Update quantity
      const newItems = [...manualItems];
      const newQty = newItems[existingIndex].quantity + quantity;
      if (newQty > selectedLotData.quantityAvailable) {
        toast.error(`Cantidad maxima disponible: ${selectedLotData.quantityAvailable}`);
        return;
      }
      newItems[existingIndex].quantity = newQty;
      setManualItems(newItems);
    } else {
      // Add new item
      setManualItems([
        ...manualItems,
        {
          id: Date.now(),
          productId: selectedProductData.productId,
          productName: selectedProductData.productName,
          sapItemCode: selectedProductData.sapItemCode,
          loteId: selectedLot,
          lotNumber: selectedLotData.lotNumber,
          quantity: quantity,
          expiryDate: selectedLotData.expiryDate,
          price: selectedProductData.price,
          currency: selectedProductData.currency,
        },
      ]);
    }

    // Reset selection
    setSelectedLot('');
    setQuantity(1);
    toast.success('Item agregado');
  };

  const handleRemoveManualItem = (id) => {
    setManualItems(manualItems.filter((item) => item.id !== id));
  };

  const handleExtractedItemChange = (id, field, value) => {
    setExtractedItems(
      extractedItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleRemoveExtractedItem = (id) => {
    setExtractedItems(extractedItems.filter((item) => item.id !== id));
  };

  const handleExtract = () => {
    if (uploadedFiles.length === 0) {
      toast.error('Selecciona al menos un archivo');
      return;
    }
    if (!selectedCentro) {
      toast.error('Selecciona un Centro primero');
      return;
    }
    extractMutation.mutate(uploadedFiles);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedCentro) {
      toast.error('Selecciona un Centro');
      return;
    }

    if (!selectedCentroData?.sapIntegration?.cardCode) {
      toast.error('El Centro no tiene cliente SAP configurado. Configure el cliente en Locaciones.');
      return;
    }

    // Get items based on active tab
    const sourceItems = activeTab === 'document' ? extractedItems : manualItems;

    const validItems = sourceItems.filter(
      (item) => item.loteId && item.quantity > 0
    );

    if (validItems.length === 0) {
      toast.error('Agrega al menos un item con lote seleccionado');
      return;
    }

    const data = {
      centroId: selectedCentro,
      items: validItems.map((item) => ({
        loteId: item.loteId,
        productId: item.productId,
        quantity: parseInt(item.quantity),
      })),
      patientName: patientName || undefined,
      doctorName: doctorName || undefined,
      procedureDate: procedureDate || undefined,
      procedureType: procedureType || undefined,
      notes: notes || undefined,
    };

    createMutation.mutate(data);
  };

  const handleCloseResult = () => {
    setResultDialogOpen(false);
    navigate('/consumption/history');
  };

  const currentItems = activeTab === 'document' ? extractedItems : manualItems;
  const totalQuantity = currentItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Registrar Consumo</h1>
        <p className="text-muted-foreground">
          Registrar productos consumidos en un Centro - Se crea Entrega en SAP
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Centro Selection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Centro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Centro *</Label>
                <Select
                  value={selectedCentro}
                  onValueChange={(value) => {
                    setSelectedCentro(value);
                    // Reset items when changing centro
                    setManualItems([]);
                    setExtractedItems([]);
                    setSelectedProduct('');
                    setSelectedLot('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar centro" />
                  </SelectTrigger>
                  <SelectContent>
                    {centros.map((centro) => (
                      <SelectItem key={centro._id} value={centro._id}>
                        <div className="flex items-center gap-2">
                          <span>{centro.name}</span>
                          {centro.sapIntegration?.cardCode ? (
                            <Badge variant="outline" className="text-xs">
                              {centro.sapIntegration.cardCode}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              Sin SAP
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCentroData && (
                <div className="text-sm space-y-1">
                  <div className="text-muted-foreground">Cliente SAP:</div>
                  {selectedCentroData.sapIntegration?.cardCode ? (
                    <div>
                      <span className="font-medium">{selectedCentroData.sapIntegration.cardName}</span>
                      <span className="text-muted-foreground ml-2">
                        ({selectedCentroData.sapIntegration.cardCode})
                      </span>
                    </div>
                  ) : (
                    <div className="text-orange-600">
                      No configurado - Configure en Locaciones
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex border-b mb-6">
          <button
            type="button"
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'manual'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('manual')}
          >
            <Edit3 className="h-4 w-4 inline-block mr-2" />
            Manual
          </button>
          <button
            type="button"
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'document'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('document')}
          >
            <FileUp className="h-4 w-4 inline-block mr-2" />
            Desde Documento
          </button>
        </div>

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Agregar Items</CardTitle>
              <CardDescription>
                Seleccione productos del inventario disponible en este Centro
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedCentro ? (
                <div className="text-center py-8 text-muted-foreground">
                  Seleccione un Centro para ver el inventario disponible
                </div>
              ) : loadingInventory ? (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <span className="text-muted-foreground">Cargando inventario...</span>
                </div>
              ) : availableProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay productos disponibles en este Centro
                </div>
              ) : (
                <>
                  {/* Product/Lot Selection */}
                  <div className="grid gap-4 md:grid-cols-4 items-end">
                    <div className="md:col-span-2 grid gap-2">
                      <Label>Producto</Label>
                      <Select value={selectedProduct} onValueChange={(val) => {
                        setSelectedProduct(val);
                        setSelectedLot('');
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar producto" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableProducts.map((prod) => (
                            <SelectItem key={prod.productId} value={prod.productId}>
                              <div>
                                <span>{prod.productName}</span>
                                <span className="text-muted-foreground ml-2 text-xs">
                                  ({prod.lots.reduce((s, l) => s + l.quantityAvailable, 0)} disp.)
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label>Lote</Label>
                      <Select
                        value={selectedLot}
                        onValueChange={setSelectedLot}
                        disabled={!selectedProduct}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar lote" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLots.map((lot) => (
                            <SelectItem key={lot.loteId} value={lot.loteId}>
                              <div className="text-sm">
                                <span>{lot.lotNumber}</span>
                                <span className="text-muted-foreground ml-2">
                                  ({lot.quantityAvailable} disp. - {formatDate(lot.expiryDate)})
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2 items-end">
                      <div className="grid gap-2 flex-1">
                        <Label>Cant.</Label>
                        <Input
                          type="number"
                          min="1"
                          max={selectedLotData?.quantityAvailable || 999}
                          value={quantity}
                          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                          disabled={!selectedLot}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddManualItem}
                        disabled={!selectedLot}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Items Table */}
                  {manualItems.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Producto</th>
                            <th className="px-3 py-2 text-left font-medium">Lote</th>
                            <th className="px-3 py-2 text-left font-medium">Vence</th>
                            <th className="px-3 py-2 text-center font-medium w-20">Cant</th>
                            <th className="px-3 py-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {manualItems.map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="px-3 py-2">
                                <div className="font-medium text-sm">{item.productName}</div>
                                <div className="text-xs text-muted-foreground">
                                  SAP: {item.sapItemCode}
                                </div>
                              </td>
                              <td className="px-3 py-2 font-mono text-sm">{item.lotNumber}</td>
                              <td className="px-3 py-2 text-sm">{formatDate(item.expiryDate)}</td>
                              <td className="px-3 py-2 text-center font-medium">{item.quantity}</td>
                              <td className="px-3 py-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveManualItem(item.id)}
                                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Document Extraction Tab */}
        {activeTab === 'document' && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Subir Documentos</CardTitle>
              <CardDescription>
                Sube fotos de stickers, notas o reportes de consumo para extraer datos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedCentro ? (
                <div className="text-center py-8 text-muted-foreground">
                  Seleccione un Centro primero
                </div>
              ) : (
                <>
                  {/* File Upload */}
                  <FileUploader
                    files={uploadedFiles}
                    onFilesChange={setUploadedFiles}
                    disabled={extractMutation.isPending}
                  />

                  {/* Extract Button */}
                  {uploadedFiles.length > 0 && extractedItems.length === 0 && (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        onClick={handleExtract}
                        disabled={extractMutation.isPending}
                        className="min-w-[200px]"
                      >
                        {extractMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Extrayendo datos...
                          </>
                        ) : (
                          <>
                            <FileUp className="mr-2 h-4 w-4" />
                            Extraer Datos
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Warnings */}
                  {extractionWarnings.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-yellow-700 font-medium mb-1">
                        <AlertCircle className="h-4 w-4" />
                        Advertencias
                      </div>
                      <ul className="text-sm text-yellow-600 list-disc list-inside">
                        {extractionWarnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Extracted Items Table */}
                  {extractedItems.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">
                          Items Extraidos ({extractedItems.length})
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setExtractedItems([]);
                            setUploadedFiles([]);
                            setExtractionWarnings([]);
                          }}
                        >
                          Limpiar
                        </Button>
                      </div>

                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Producto</th>
                              <th className="px-3 py-2 text-left font-medium">Lote</th>
                              <th className="px-3 py-2 text-center font-medium w-20">Cant</th>
                              <th className="px-3 py-2 text-left font-medium w-24">Estado</th>
                              <th className="px-3 py-2 w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {extractedItems.map((item) => (
                              <tr key={item.id} className="border-t">
                                <td className="px-3 py-2">
                                  <div className="font-medium text-sm">
                                    {item.productName || item.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    SAP: {item.sapItemCode || item.code}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  {item.needsLotSelection && item.availableLots?.length > 0 ? (
                                    <Select
                                      value={item.loteId || ''}
                                      onValueChange={(val) => {
                                        const lot = item.availableLots.find(l => l.loteId === val);
                                        handleExtractedItemChange(item.id, 'loteId', val);
                                        handleExtractedItemChange(item.id, 'lotNumber', lot?.lotNumber);
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Seleccionar" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {item.availableLots.map((lot) => (
                                          <SelectItem key={lot.loteId} value={lot.loteId}>
                                            {lot.lotNumber} ({lot.quantityAvailable})
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <span className="font-mono text-xs">
                                      {item.lotNumber || '-'}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <Input
                                    type="number"
                                    min="1"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      handleExtractedItemChange(item.id, 'quantity', e.target.value)
                                    }
                                    className="h-8 text-xs w-16 text-center"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  {item.loteId ? (
                                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                                      OK
                                    </Badge>
                                  ) : item.productId ? (
                                    <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700">
                                      Lote?
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs bg-red-50 text-red-700">
                                      No encontrado
                                    </Badge>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveExtractedItem(item.id)}
                                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {extractedItems.some(item => !item.loteId) && (
                        <div className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                          <AlertCircle className="h-4 w-4 inline-block mr-2" />
                          Algunos items necesitan seleccion de lote o no fueron encontrados en el inventario.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Optional Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Informacion Adicional</CardTitle>
            <CardDescription>Opcional - Para referencia en SAP</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="patientName">Paciente</Label>
                <Input
                  id="patientName"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Nombre del paciente"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="doctorName">Doctor</Label>
                <Input
                  id="doctorName"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="Nombre del doctor"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="procedureDate">Fecha del Procedimiento</Label>
                <Input
                  id="procedureDate"
                  type="date"
                  value={procedureDate}
                  onChange={(e) => setProcedureDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="procedureType">Tipo de Procedimiento</Label>
                <Input
                  id="procedureType"
                  value={procedureType}
                  onChange={(e) => setProcedureType(e.target.value)}
                  placeholder="PCI, TAVI, etc."
                />
              </div>
              <div className="md:col-span-2 grid gap-2">
                <Label htmlFor="notes">Notas</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionales"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary & Submit */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">
                  {currentItems.length} item(s) | {totalQuantity} unidad(es) total
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending ||
                    !selectedCentro ||
                    currentItems.length === 0 ||
                    !selectedCentroData?.sapIntegration?.cardCode
                  }
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Activity className="mr-2 h-4 w-4" />
                      Registrar Consumo
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Result Dialog */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {consumptionResult?.sapResult?.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-orange-500" />
              )}
              Consumo Registrado
            </DialogTitle>
            <DialogDescription>
              {consumptionResult?.sapResult?.success
                ? 'El consumo fue registrado y sincronizado con SAP'
                : 'El consumo fue registrado pero hubo un error con SAP'}
            </DialogDescription>
          </DialogHeader>

          {consumptionResult && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Centro:</span>
                  <span className="font-medium">{consumptionResult.consumo?.centroName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items:</span>
                  <span className="font-medium">{consumptionResult.consumo?.totalItems}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cantidad total:</span>
                  <span className="font-medium">{consumptionResult.consumo?.totalQuantity}</span>
                </div>
              </div>

              {/* SAP Result */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {consumptionResult.sapResult?.success ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-green-600">
                        Entrega creada en SAP
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                      <span className="font-medium text-orange-500">
                        Error al crear en SAP
                      </span>
                    </>
                  )}
                </div>
                {consumptionResult.sapResult?.success ? (
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">Tipo: </span>
                      <span>Entrega (DeliveryNote)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Entry: </span>
                      <span className="font-mono">{consumptionResult.sapResult.sapDocEntry}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Num: </span>
                      <Badge variant="secondary">{consumptionResult.sapResult.sapDocNum}</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {consumptionResult.sapResult?.error || 'Los datos se guardaron localmente pero no se enviaron a SAP'}
                    <div className="mt-2">
                      Puede reintentar desde el historial de consumos.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleCloseResult}>
              <Package className="mr-2 h-4 w-4" />
              Ver Historial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
