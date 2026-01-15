import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { goodsReceiptApi, pedidosApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Package, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Search, FileUp, Edit3, ShieldAlert, ShoppingCart, Link2 } from 'lucide-react';
import { useToast } from '../components/ui/toast';
import { formatDate } from '../lib/utils';
import FileUploader from '../components/FileUploader';

export default function GoodsReceipt() {
  // Tab state
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'packing'

  // Shared state
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [notes, setNotes] = useState('');

  // Known suppliers with SAP codes
  const suppliers = [
    { code: 'P00031', name: 'Centralmed' },
    { code: '', name: 'Otro' },
  ];

  // Manual entry state
  const [items, setItems] = useState([createEmptyItem()]);
  const [productSearch, setProductSearch] = useState('');
  const [searchingProduct, setSearchingProduct] = useState(null);

  // Packing list state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [extractedItems, setExtractedItems] = useState([]);
  const [extractionWarnings, setExtractionWarnings] = useState([]);

  // Result dialog
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [receiptResult, setReceiptResult] = useState(null);

  // Batch validation state
  const [batchMismatches, setBatchMismatches] = useState([]);
  const [mismatchDialogOpen, setMismatchDialogOpen] = useState(false);
  const [validatingBatches, setValidatingBatches] = useState(false);

  // Pedido linking state
  const [pedidoLinkingOpen, setPedidoLinkingOpen] = useState(false);
  const [suggestedPedidos, setSuggestedPedidos] = useState([]);
  const [linkingPedido, setLinkingPedido] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  function createEmptyItem() {
    return {
      id: Date.now(),
      productId: '',
      productName: '',
      sapItemCode: '',
      lotNumber: '',
      quantity: 1,
      expiryDate: '',
    };
  }

  // Query warehouses
  const { data: warehouses } = useQuery({
    queryKey: ['goods-receipt-warehouses'],
    queryFn: () => goodsReceiptApi.getWarehouses().then((res) => res.data),
  });

  // Query products with search
  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['goods-receipt-products', productSearch],
    queryFn: () => goodsReceiptApi.getProducts(productSearch).then((res) => res.data),
    enabled: productSearch.length >= 2,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data) => goodsReceiptApi.create(data),
    onSuccess: async (response) => {
      queryClient.invalidateQueries(['inventario']);
      queryClient.invalidateQueries(['lotes']);
      queryClient.invalidateQueries(['dashboard-stats']);
      setReceiptResult(response.data);
      setResultDialogOpen(true);

      // Check for matching pedidos
      try {
        // Get productIds from lotes (response includes lotes, not items)
        const productIds = response.data.lotes?.map(lote => lote.productId?.toString() || lote.productId).filter(Boolean);
        const uniqueProductIds = [...new Set(productIds)];
        if (uniqueProductIds?.length > 0) {
          const pedidosRes = await pedidosApi.suggestForItems(uniqueProductIds);
          if (pedidosRes.data?.length > 0) {
            setSuggestedPedidos(pedidosRes.data);
          }
        }
      } catch (err) {
        // Silent fail - pedido linking is optional
        console.log('Could not fetch suggested pedidos:', err);
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al crear recepcion');
    },
  });

  // Extraction mutation
  const extractMutation = useMutation({
    mutationFn: (files) => goodsReceiptApi.extract(files),
    onSuccess: (response) => {
      const data = response.data;
      if (data.success && data.items?.length > 0) {
        // Convert extracted items to form items format
        const formItems = data.items.map((item, idx) => ({
          id: Date.now() + idx,
          productId: item.productId || '',
          productName: item.productName || item.name,
          sapItemCode: item.sapItemCode || String(item.code),
          lotNumber: item.lotNumber || '',
          quantity: item.quantity || 1,
          expiryDate: item.expiryDate || '',
          existsInDb: item.existsInDb,
          confidence: item.confidence,
        }));
        setExtractedItems(formItems);
        setExtractionWarnings(data.warnings || []);
        toast.success(`${formItems.length} productos extraidos`);
      } else {
        toast.error('No se encontraron productos en las imagenes');
      }
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Error al extraer datos');
    },
  });

  const handleAddItem = () => {
    setItems([...items, createEmptyItem()]);
  };

  const handleRemoveItem = (id) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const handleItemChange = (id, field, value) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
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

  const handleSelectProduct = (itemId, product) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              productId: product._id,
              productName: product.name,
              sapItemCode: product.sapItemCode,
            }
          : item
      )
    );
    setSearchingProduct(null);
    setProductSearch('');
  };

  const handleExtract = () => {
    if (uploadedFiles.length === 0) {
      toast.error('Selecciona al menos un archivo');
      return;
    }
    extractMutation.mutate(uploadedFiles);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate warehouse and supplier
    if (!selectedWarehouse) {
      toast.error('Selecciona un almacen');
      return;
    }

    if (!selectedSupplier || selectedSupplier === 'other') {
      toast.error('Selecciona un proveedor con codigo SAP para crear Entrada de Mercancia');
      return;
    }

    // Get items based on active tab
    const sourceItems = activeTab === 'packing' ? extractedItems : items;

    const validItems = sourceItems.filter(
      (item) => item.productId && item.lotNumber && item.quantity && item.expiryDate
    );

    if (validItems.length === 0) {
      toast.error('Agrega al menos un producto con todos los campos');
      return;
    }

    // Validate batches against SAP before creating
    setValidatingBatches(true);
    try {
      const validationItems = validItems.map((item) => ({
        lotNumber: item.lotNumber,
        productCode: item.sapItemCode,
      }));

      const response = await goodsReceiptApi.validateBatches(validationItems);
      const validation = response.data;

      if (!validation.valid && validation.mismatches?.length > 0) {
        // Show mismatch dialog - don't allow creation
        setBatchMismatches(validation.mismatches);
        setMismatchDialogOpen(true);
        setValidatingBatches(false);
        return;
      }
    } catch (error) {
      console.error('Batch validation error:', error);
      // If validation fails, show warning but allow user to proceed
      toast.warning('No se pudo validar los lotes contra SAP. Verifique los datos.');
    }
    setValidatingBatches(false);

    // Get supplier info
    const supplierObj = suppliers.find(s => (s.code || 'other') === selectedSupplier);
    const supplierCode = selectedSupplier && selectedSupplier !== 'other' ? selectedSupplier : undefined;
    const supplierName = supplierObj?.name || undefined;

    const data = {
      locationId: selectedWarehouse,
      supplier: supplierName,
      supplierCode: supplierCode,
      notes: notes || undefined,
      pushToSap: true,
      items: validItems.map((item) => ({
        productId: item.productId,
        lotNumber: item.lotNumber,
        quantity: parseInt(item.quantity),
        expiryDate: item.expiryDate,
      })),
    };

    createMutation.mutate(data);
  };

  const handleCloseResult = () => {
    setResultDialogOpen(false);
    // If there are suggested pedidos, show linking dialog instead of navigating
    if (suggestedPedidos.length > 0) {
      setPedidoLinkingOpen(true);
    } else {
      navigate('/inventory');
    }
  };

  const handleSkipPedidoLinking = () => {
    setPedidoLinkingOpen(false);
    setSuggestedPedidos([]);
    navigate('/inventory');
  };

  const handleLinkPedido = async (pedido) => {
    if (!receiptResult?.receiptId) {
      console.error('handleLinkPedido called without receiptResult');
      return;
    }

    setLinkingPedido(true);
    try {
      // Build items to receive based on what matches between receipt lotes and pedido
      // Group receipt lotes by productId and sum quantities
      const receiptByProduct = {};
      (receiptResult.lotes || []).forEach(lote => {
        const productId = lote.productId?.toString() || lote.productId;
        if (!receiptByProduct[productId]) {
          receiptByProduct[productId] = 0;
        }
        receiptByProduct[productId] += lote.quantityTotal || lote.quantityAvailable || 0;
      });

      const itemsToReceive = pedido.items
        .filter(item => receiptByProduct[item.productId.toString()])
        .map(item => {
          const productId = item.productId.toString();
          const receiptQty = receiptByProduct[productId] || 0;
          const pendingQty = item.quantityOrdered - item.quantityReceived;
          // Receive the minimum of: pending quantity or received quantity
          const qtyToReceive = Math.min(pendingQty, receiptQty);
          return {
            productId: item.productId,
            quantityReceived: qtyToReceive,
          };
        })
        .filter(item => item.quantityReceived > 0);

      if (itemsToReceive.length === 0) {
        toast.warning('No hay productos coincidentes para vincular');
        setLinkingPedido(false);
        return;
      }

      await pedidosApi.receiveItems(pedido._id, {
        items: itemsToReceive,
        goodsReceiptId: receiptResult.receiptId,
      });

      toast.success('Pedido actualizado exitosamente');
      queryClient.invalidateQueries(['pedidos']);

      // Remove this pedido from suggestions
      setSuggestedPedidos(prev => prev.filter(p => p._id !== pedido._id));

      // If no more suggestions, close and navigate
      if (suggestedPedidos.length <= 1) {
        setPedidoLinkingOpen(false);
        navigate('/inventory');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Error al vincular pedido');
    } finally {
      setLinkingPedido(false);
    }
  };

  const currentItems = activeTab === 'packing' ? extractedItems : items;
  const totalQuantity = currentItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Recepcion de Mercancia</h1>
        <p className="text-muted-foreground">
          Registrar productos recibidos - Se guarda localmente y se envia a SAP
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Header Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Informacion General</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>Almacen Destino *</Label>
                <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar almacen" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses?.map((wh) => (
                      <SelectItem key={wh._id} value={wh._id}>
                        {wh.name}
                        {wh.sapIntegration?.warehouseCode && (
                          <span className="text-muted-foreground ml-2">
                            (SAP: {wh.sapIntegration.warehouseCode})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Proveedor *</Label>
                <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((sup) => (
                      <SelectItem key={sup.code || 'other'} value={sup.code || 'other'}>
                        {sup.name}
                        {sup.code && (
                          <span className="text-muted-foreground ml-2">
                            ({sup.code})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Notas</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas adicionales"
                />
              </div>
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
              activeTab === 'packing'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('packing')}
          >
            <FileUp className="h-4 w-4 inline-block mr-2" />
            Desde Packing List
          </button>
        </div>

        {/* Manual Entry Tab */}
        {activeTab === 'manual' && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Productos</CardTitle>
                  <CardDescription>
                    Agrega los productos recibidos con su lote y fecha de vencimiento
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Agregar Producto
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {items.map((item, index) => (
                  <div key={item.id} className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">
                        Item {index + 1}
                      </span>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Product Selection */}
                    <div className="grid gap-2">
                      <Label>Producto *</Label>
                      {item.productId ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 border rounded-md px-3 py-2 bg-muted/50">
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">
                              SAP: {item.sapItemCode}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleItemChange(item.id, 'productId', '')}
                          >
                            Cambiar
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Buscar producto por nombre o codigo SAP..."
                              value={searchingProduct === item.id ? productSearch : ''}
                              onChange={(e) => {
                                setSearchingProduct(item.id);
                                setProductSearch(e.target.value);
                              }}
                              onFocus={() => setSearchingProduct(item.id)}
                            />
                            <Button type="button" variant="outline" size="icon">
                              <Search className="h-4 w-4" />
                            </Button>
                          </div>
                          {searchingProduct === item.id && products && products.length > 0 && (
                            <div className="border rounded-md max-h-48 overflow-y-auto">
                              {products.map((product) => (
                                <button
                                  key={product._id}
                                  type="button"
                                  className="w-full px-3 py-2 text-left hover:bg-muted/50 border-b last:border-b-0"
                                  onClick={() => handleSelectProduct(item.id, product)}
                                >
                                  <div className="font-medium text-sm">{product.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {product.code} | SAP: {product.sapItemCode}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {searchingProduct === item.id && loadingProducts && (
                            <div className="text-sm text-muted-foreground flex items-center">
                              <Loader2 className="h-3 w-3 animate-spin mr-2" />
                              Buscando...
                            </div>
                          )}
                          {searchingProduct === item.id &&
                            productSearch.length >= 2 &&
                            !loadingProducts &&
                            products?.length === 0 && (
                              <div className="text-sm text-muted-foreground">
                                No se encontraron productos con codigo SAP
                              </div>
                            )}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="grid gap-2">
                        <Label>Numero de Lote *</Label>
                        <Input
                          value={item.lotNumber}
                          onChange={(e) =>
                            handleItemChange(item.id, 'lotNumber', e.target.value)
                          }
                          placeholder="LOT-2024-001"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Cantidad *</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            handleItemChange(item.id, 'quantity', e.target.value)
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Fecha de Vencimiento *</Label>
                        <Input
                          type="date"
                          value={item.expiryDate}
                          onChange={(e) =>
                            handleItemChange(item.id, 'expiryDate', e.target.value)
                          }
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Packing List Tab */}
        {activeTab === 'packing' && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Subir Packing List</CardTitle>
              <CardDescription>
                Sube imagenes o PDFs del packing list para extraer los datos automaticamente
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                      Productos Extraidos ({extractedItems.length})
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
                          <th className="px-3 py-2 text-left font-medium w-20">Cant</th>
                          <th className="px-3 py-2 text-left font-medium">Vence</th>
                          <th className="px-3 py-2 text-left font-medium w-16">Estado</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {extractedItems.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2">
                              <div className="font-medium text-xs">{item.productName}</div>
                              <div className="text-xs text-muted-foreground">
                                SAP: {item.sapItemCode}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={item.lotNumber}
                                onChange={(e) =>
                                  handleExtractedItemChange(item.id, 'lotNumber', e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  handleExtractedItemChange(item.id, 'quantity', e.target.value)
                                }
                                className="h-8 text-xs w-16"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="date"
                                value={item.expiryDate}
                                onChange={(e) =>
                                  handleExtractedItemChange(item.id, 'expiryDate', e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {item.existsInDb ? (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                                  OK
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700">
                                  Nuevo
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

                  {extractedItems.some(item => !item.existsInDb) && (
                    <div className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                      <AlertCircle className="h-4 w-4 inline-block mr-2" />
                      Algunos productos no existen en la base de datos. Se crearan automaticamente al guardar.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary & Submit */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">
                  {currentItems.filter((i) => i.productId || i.sapItemCode).length} producto(s) | {totalQuantity} unidad(es) total
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || validatingBatches || !selectedWarehouse || currentItems.length === 0}
                >
                  {validatingBatches ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validando lotes...
                    </>
                  ) : createMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Package className="mr-2 h-4 w-4" />
                      Crear Recepcion
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
              {receiptResult?.sapResult?.success ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Recepcion Creada Exitosamente
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  Recepcion Creada con Errores
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {receiptResult?.sapResult?.success
                ? 'Los productos han sido registrados en el inventario y SAP'
                : 'Los productos se guardaron localmente pero hubo un error con SAP'}
            </DialogDescription>
          </DialogHeader>

          {receiptResult && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lotes creados:</span>
                  <span className="font-medium">{receiptResult.lotes?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transacciones:</span>
                  <span className="font-medium">{receiptResult.transactions?.length || 0}</span>
                </div>
              </div>

              {/* SAP Result */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {receiptResult.sapResult?.success ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-green-600">
                        Entrada de Mercancia creada en SAP
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
                {receiptResult.sapResult?.success ? (
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">Tipo: </span>
                      <span>Entrada de Mercancia (Goods Receipt PO)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Entry: </span>
                      <span className="font-mono">{receiptResult.sapResult.sapDocEntry}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Doc Num: </span>
                      <Badge variant="secondary">{receiptResult.sapResult.sapDocNum}</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {receiptResult.sapResult?.error || 'Los datos se guardaron localmente pero no se enviaron a SAP'}
                  </div>
                )}
              </div>
            </div>
          )}

          {suggestedPedidos.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-3">
              <ShoppingCart className="h-5 w-5 text-purple-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-purple-800">
                  {suggestedPedidos.length} pedido{suggestedPedidos.length !== 1 ? 's' : ''} pendiente{suggestedPedidos.length !== 1 ? 's' : ''}
                </span>
                <span className="text-purple-700">
                  {' '}con productos de esta recepcion
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleCloseResult}>
              {suggestedPedidos.length > 0 ? (
                <>
                  <Link2 className="h-4 w-4 mr-2" />
                  Vincular Pedidos
                </>
              ) : (
                'Ver Inventario'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Mismatch Warning Dialog */}
      <Dialog open={mismatchDialogOpen} onOpenChange={setMismatchDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Error de Validacion SAP
            </DialogTitle>
            <DialogDescription>
              Los siguientes lotes estan asignados a productos diferentes en SAP.
              Corrija la seleccion de producto antes de continuar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-96 overflow-y-auto">
            {batchMismatches.map((mismatch, idx) => (
              <div key={idx} className="border border-red-200 bg-red-50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="font-medium text-red-800">
                      Lote: {mismatch.lotNumber}
                    </div>
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600">Seleccionado:</span>
                        <Badge variant="outline" className="bg-red-100 text-red-700">
                          {mismatch.expectedItemCode}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">Correcto en SAP:</span>
                        <Badge variant="outline" className="bg-green-100 text-green-700">
                          {mismatch.sapItemCode}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 bg-white/50 rounded p-2 mt-2">
                      {mismatch.message}
                    </div>
                    {mismatch.correctProductId && (
                      <div className="text-xs text-gray-500 mt-1">
                        Producto correcto: {mismatch.correctProductName} (codigo {mismatch.correctProductCode})
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            <strong>Importante:</strong> Debe corregir el producto seleccionado para cada lote
            con error antes de poder crear la recepcion. Cierre este dialogo y edite los productos.
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMismatchDialogOpen(false)}
            >
              Cerrar y Corregir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pedido Linking Dialog */}
      <Dialog open={pedidoLinkingOpen} onOpenChange={(open) => {
        if (!open) {
          // User dismissed dialog - navigate to inventory
          handleSkipPedidoLinking();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-purple-600" />
              Vincular a Pedido
            </DialogTitle>
            <DialogDescription>
              Se encontraron pedidos pendientes con productos de esta recepcion.
              Selecciona cual actualizar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {suggestedPedidos.map((pedido) => {
              const totalPending = pedido.items.reduce(
                (sum, item) => sum + (item.quantityOrdered - item.quantityReceived),
                0
              );
              return (
                <div
                  key={pedido._id}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-purple-600" />
                        <span className="font-medium">
                          Pedido del {formatDate(pedido.orderDate)}
                        </span>
                        <Badge className="bg-yellow-100 text-yellow-800 border-0">
                          {totalPending} pendientes
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {pedido.items.length} producto{pedido.items.length !== 1 ? 's' : ''} coincidentes
                      </div>
                      <div className="mt-2 space-y-1">
                        {pedido.items.slice(0, 3).map((item, idx) => (
                          <div key={idx} className="text-sm flex items-center gap-2">
                            <span className="text-muted-foreground">•</span>
                            <span>
                              {item.quantityOrdered - item.quantityReceived} x Producto {item.productId.toString().slice(-6)}
                            </span>
                          </div>
                        ))}
                        {pedido.items.length > 3 && (
                          <div className="text-sm text-muted-foreground">
                            ... y {pedido.items.length - 3} mas
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={() => handleLinkPedido(pedido)}
                      disabled={linkingPedido}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {linkingPedido ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Link2 className="h-4 w-4 mr-1" />
                          Vincular
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleSkipPedidoLinking}
              disabled={linkingPedido}
            >
              Omitir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
