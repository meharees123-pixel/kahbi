import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { finalize, firstValueFrom, switchMap } from 'rxjs';
import { LoadingIndicatorService } from './loading-indicator.service';

interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  restaurantId?: string;
  demo?: boolean;
  primaryAddressId?: string | null;
}

interface CustomerAddress {
  id: string;
  labelType: 'HOME' | 'OFFICE' | 'OTHER';
  customLabel: string;
  floorNumber: string;
  roomNumber: string;
  buildingNumber: string;
  streetNumber: string;
  zone: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Restaurant {
  _id: string;
  name: string;
  imageData?: string;
  hotelName?: string;
  cuisine: string[];
  description: string;
  address: string;
  phone?: string;
  email?: string;
  approvalStatus?: string;
  latitude?: number | null;
  longitude?: number | null;
  serviceRadiusKm?: number | null;
  paymentMethods?: string[];
  category: string;
  preparationMinutes: number;
  minOrder: number;
  maxOrder: number;
  status: string;
  availability: string;
  availabilityStart: string;
  availabilityEnd: string;
  whatsapp?: string;
  ratingAverage: number;
  ratingCount: number;
  distanceKm?: number | null;
  demo?: boolean;
}

interface MenuItem {
  _id: string;
  itemCode?: string;
  name: string;
  imageData?: string;
  imageUrl?: string;
  active?: boolean;
  description: string;
  category: string;
  price: number;
  discountPrice?: number | null;
  foodType?: string | null;
  customizationOptions?: string;
  availabilityStart?: string;
  availabilityEnd?: string;
  preparationMinutes?: number;
  availability: string;
  approvalStatus?: string;
  bestSeller: boolean;
  chefRecommended: boolean;
}

interface CustomerCart {
  restaurant: Restaurant;
  items: (MenuItem & { quantity: number })[];
}

interface BulkMenuRow {
  rowNumber: number;
  restaurantId: string;
  itemId: string;
  category: string;
  name: string;
  description: string;
  price: number | string;
  discountPrice?: number | string | null;
  foodType?: string;
  preparationMinutes?: number | string | null;
  availability: string;
  availabilityStart: string;
  availabilityEnd: string;
  imageUrl: string;
  customizationOptions: string;
  errors: string[];
  existingItemId?: string;
  existingItemName?: string;
}

interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderRestaurant {
  name: string;
  address: string;
  phone?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface Order {
  _id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  restaurant?: OrderRestaurant | null;
  guest: { name: string; phone: string };
  items: OrderItem[];
  address: string;
  total: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  adminFee: number;
  tax: number;
  currency: string;
  paymentMethod?: string;
  status: string;
  statusHistory: { status: string; createdAt: string }[];
  acceptanceDeadlineAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  commissionAmount?: number;
  feedbackSubmitted?: boolean;
  completedAt?: string | null;
  feedback?: FeedbackEntry | null;
}

interface OrderQuote {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  currency: string;
  promotionCode: string;
}

interface CustomerTerms {
  version: string;
  clauses: string[];
  acceptanceRequired?: boolean;
}

interface FeedbackEntry {
  _id: string;
  orderId: string;
  restaurantId: string;
  customerId?: string | null;
  customerContact?: string;
  overallRating: number;
  foodRating?: number | null;
  deliveryRating?: number | null;
  comment?: string;
  submittedAt: string;
}

interface FeedbackSummary {
  totalFeedback: number;
  averageOverallRating: number;
  averageFoodRating: number;
  averageDeliveryRating: number;
  trend: { bucket: string; averageOverallRating: number; count: number }[];
}

interface Promotion {
  _id?: string;
  code: string;
  title: string;
  description: string;
  active?: boolean;
}

interface Advertisement {
  _id: string;
  title: string;
  description: string;
  active: boolean;
  demo?: boolean;
}

interface CustomerRecord {
  _id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
}

interface BillingRecord {
  grossAmount: number;
  commissionAmount: number;
  netRestaurantAmount: number;
  currency: string;
  createdAt: string;
}

interface WhatsappConfigStatus {
  configured: boolean;
  source: 'admin' | 'environment';
  otpDeliveryEnabled: boolean;
  developmentOtpAllowed: boolean;
  accessTokenConfigured: boolean;
  phoneNumberIdConfigured: boolean;
  otpSecretConfigured: boolean;
  otpSecretPersistent: boolean;
  encryptionKeyConfigured: boolean;
  templateName: string;
  language: string;
  graphVersion: string;
}

interface MapPoint {
  lat: number;
  lng: number;
}

interface PartnerApplication {
  restaurantName: string;
  restaurantType: string;
  primaryCuisine: string;
  additionalCuisines: string[];
  description: string;
  logoImageData: string;
  coverImageData: string;
  paymentMethods: string[];
  ownerName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  country: string;
  city: string;
  zoneNumber: string;
  streetBuilding: string;
  latitude: number | null;
  longitude: number | null;
  openingTime: string;
  closingTime: string;
  preparationMinutes: number;
  estimatedDeliveryMinutes: number;
  serviceRadiusKm: number;
  extendedDeliveryAvailable: boolean;
  extendedDeliveryRadiusKm: number | null;
  minimumOrderValue: number | null;
  maximumOrderValue: number | null;
  deliveryManagedBy: string;
  deliveryFee: number | null;
  freeDeliveryThreshold: number | null;
  currency: string;
  declarations: {
    authorized: boolean;
    accurate: boolean;
    terms: boolean;
    approval: boolean;
    adminReview: boolean;
  };
}

interface PartnerRegistration {
  registrationId: string;
  status: string;
  details?: PartnerApplication;
  termsVersion: string;
  termsAcceptedAt: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
  reviewReason?: string;
  correctionAllowed: boolean;
  restaurantId?: string | null;
  activatedAt?: string | null;
}

type PartnerFormErrorField =
  | 'restaurantName' | 'restaurantType' | 'primaryCuisine' | 'ownerName' | 'phone' | 'whatsapp' | 'email'
  | 'address' | 'country' | 'city' | 'mapLocation' | 'openingTime' | 'closingTime' | 'preparationMinutes'
  | 'estimatedDeliveryMinutes' | 'serviceRadiusKm' | 'extendedDeliveryRadiusKm' | 'minimumOrderValue'
  | 'maximumOrderValue' | 'deliveryManagedBy' | 'deliveryFee' | 'freeDeliveryThreshold' | 'currency' | 'paymentMethods'
  | 'declaration_authorized' | 'declaration_accurate' | 'declaration_terms' | 'declaration_approval'
  | 'declaration_adminReview' | 'logoImageData' | 'coverImageData' | 'termsVersion';

type LoginPortal = 'CUSTOMER' | 'RESTAURANT' | 'ADMIN';

@Component({
  selector: 'kahbi-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly maxImageBytes = 256 * 1024;
  private readonly maxSourceImageBytes = 10 * 1024 * 1024;
  private readonly maxImagePixels = 40_000_000;
  private readonly api = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api';
  private readonly tokenKey = 'kahbi.session';
  private readonly cartStorageKey = 'kahbi.guest-cart';
  private readonly deliveryLocationKeys = {
    latitude: 'kahbi.delivery.latitude',
    longitude: 'kahbi.delivery.longitude',
    label: 'kahbi.delivery.label'
  };
  private mapPicker: L.Map | null = null;
  private mapMarker: L.Marker | null = null;
  private mapGeocodeTimer: ReturnType<typeof setTimeout> | null = null;
  private mapSelectionRequest = 0;
  view = 'home';
  authModalOpen = false;
  authModalView: 'login' | 'signup' = 'login';
  loginPortal: LoginPortal = 'CUSTOMER';
  user: User | null = null;
  restaurants: Restaurant[] = [];
  expandedRestaurantPhoneId = '';
  menu: MenuItem[] = [];
  selectedRestaurant: Restaurant | null = null;
  promotions: Promotion[] = [];
  advertisements: Advertisement[] = [];
  cart: { [id: string]: number } = {};
  private cartMenu: MenuItem[] = [];
  orderQuote: OrderQuote | null = null;
  orderQuoteLoading = false;
  private orderQuoteRequest = 0;
  private customerCartSync: Promise<void> = Promise.resolve();
  customerTerms: CustomerTerms | null = null;
  customerTermsLoading = false;
  customerTermsAccepted = false;
  customerTermsModalOpen = false;
  adminCustomerTerms: CustomerTerms | null = null;
  adminCustomerTermsDraft = '';
  adminCustomerTermsLoading = false;
  adminCustomerTermsSaving = false;
  orders: Order[] = [];
  restaurantOrders: Order[] = [];
  completedRestaurantOrders: Order[] = [];
  restaurantOrderTab: 'active' | 'completed' = 'active';
  completedRestaurantOrdersPage = 1;
  completedRestaurantOrdersTotal = 0;
  completedRestaurantOrdersTotalPages = 0;
  completedRestaurantOrdersLoading = false;
  restaurantMenu: MenuItem[] = [];
  restaurantPaymentMethods: string[] = ['CASH_TO_RESTAURANT'];
  restaurantPaymentMethodsSaving = false;
  countdownNow = Date.now();
  private acceptanceCountdownTimer: number | null = null;
  private nextExpiredOrderRefreshAt = 0;
  pendingRestaurants: Restaurant[] = [];
  adminRestaurants: Restaurant[] = [];
  adminRestaurant: Restaurant | null = null;
  adminRestaurantTab: 'details' | 'ordersFeedback' = 'details';
  adminRestaurantOrders: Order[] = [];
  adminRestaurantOrdersPage = 1;
  adminRestaurantOrdersTotal = 0;
  adminRestaurantOrdersTotalPages = 0;
  adminRestaurantOrdersLoading = false;
  adminCuisineDraft = '';
  adminRestaurantSearch = '';
  adminMenu: MenuItem[] = [];
  allOrders: Order[] = [];
  metrics: { [key: string]: number } = {};
  messageLogs: { template: string; status: string; recipient: string }[] = [];
  auditLogs: { action: string; entity: string; createdAt: string }[] = [];
  billingTransactions: BillingRecord[] = [];
  restaurantBilling: BillingRecord[] = [];
  customers: CustomerRecord[] = [];
  feedbackEntries: FeedbackEntry[] = [];
  feedbackSummary: FeedbackSummary = {
    totalFeedback: 0,
    averageOverallRating: 0,
    averageFoodRating: 0,
    averageDeliveryRating: 0,
    trend: []
  };
  feedbackDrafts: Record<string, { overallRating: number; foodRating: number; deliveryRating: number; comment: string }> = {};
  feedbackSubmitted: Record<string, boolean> = {};
  feedbackBannerDismissed = false;
  feedbackModalOrder: Order | null = null;
  feedbackModalOpen = false;
  adminWhatsappStatus: WhatsappConfigStatus | null = null;
  whatsappAccessToken = '';
  whatsappPhoneNumberId = '';
  whatsappOtpDeliveryEnabled = true;
  whatsappTemplateName = 'kahbi_customer_otp';
  whatsappLanguage = 'en_US';
  whatsappGraphVersion = 'v23.0';
  private errorDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private errorMessage = '';
  notice = '';
  loading = false;
  search = '';
  openOnly = false;
  guestPhone = '';
  deliveryBuildingNumber = '';
  deliveryStreetNumber = '';
  deliveryZone = '';
  deliveryArea = '';
  deliveryFloorNumber = '';
  deliveryRoomNumber = '';
  deliveryAddressLabelType: CustomerAddress['labelType'] = 'HOME';
  deliveryCustomAddressLabel = '';
  selectedCheckoutAddressId = '';
  saveCheckoutAddress = false;
  deliveryLatitude: number | null = null;
  deliveryLongitude: number | null = null;
  deliveryLocationLabel = '';
  customerAddresses: CustomerAddress[] = [];
  customerAddressDraft: CustomerAddress = {
    id: '',
    labelType: 'HOME',
    customLabel: '',
    floorNumber: '',
    roomNumber: '',
    buildingNumber: '',
    streetNumber: '',
    zone: '',
    area: '',
    latitude: null,
    longitude: null,
    isPrimary: false
  };
  customerAddressFormOpen = false;
  mapPickerOpen = false;
  mapPickerPurpose: 'delivery' | 'customerAddress' | 'signupRestaurant' | 'partnerRegistration' | 'adminCreateRestaurant' | 'adminEditRestaurant' = 'delivery';
  mapSelection: MapPoint | null = null;
  mapSelectionAddress = '';
  mapLoading = false;
  mapError = '';
  mapNotice = '';
  promotionCode = '';
  orderPaymentMethod = 'CASH_TO_RESTAURANT';
  trackReference = '';
  trackPhone = '';
  trackedOrder: Order | null = null;
  authEmail = '';
  authPassword = '';
  signupName = '';
  signupPhone = '';
  customerAuthPhone = '';
  customerOtpCode = '';
  customerOtpChallengeId = '';
  customerOtpDevelopmentCode = '';
  customerOtpPurpose: 'LOGIN' | 'ORDER' = 'LOGIN';
  signupRestaurant = false;
  signupRestaurantName = '';
  signupCuisine = '';
  signupAddress = '';
  signupLatitude: number | null = null;
  signupLongitude: number | null = null;
  signupServiceRadiusKm = 5;
  partnerTermsVersion = '2026-10-v1';
  partnerLogoData = '';
  partnerReviewMode = false;
  partnerRegistration: PartnerRegistration | null = null;
  partnerRegistrationAccessToken = '';
  partnerRequestId = '';
  partnerFormErrors: Partial<Record<PartnerFormErrorField, string>> = {};
  partnerReviewReasons: Record<string, string> = {};
  adminPartnerRegistrations: PartnerRegistration[] = [];
  adminActivationUrl = '';
  legalPage = 'terms';
  brandLogoData = '';
  brandLogoDraft: string | null = null;
  activationToken = '';
  activationEmail = '';
  activationPassword = '';
  private readonly partnerAccessPrefix = 'kahbi.partner-registration.';
  partnerApplication: PartnerApplication = {
    restaurantName: '',
    restaurantType: 'Restaurant',
    primaryCuisine: '',
    additionalCuisines: [],
    description: '',
    logoImageData: '',
    coverImageData: '',
    paymentMethods: ['CASH_TO_RESTAURANT'],
    ownerName: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    country: 'Qatar',
    city: '',
    zoneNumber: '',
    streetBuilding: '',
    latitude: null,
    longitude: null,
    openingTime: '',
    closingTime: '',
    preparationMinutes: 35,
    estimatedDeliveryMinutes: 45,
    serviceRadiusKm: 5,
    extendedDeliveryAvailable: false,
    extendedDeliveryRadiusKm: null,
    minimumOrderValue: null,
    maximumOrderValue: null,
    deliveryManagedBy: 'Restaurant',
    deliveryFee: null,
    freeDeliveryThreshold: null,
    currency: 'QAR',
    declarations: {
      authorized: false,
      accurate: false,
      terms: false,
      approval: false,
      adminReview: false
    }
  };
  newItemName = '';
  newItemCategory = '';
  newItemPrice = 0;
  newItemDescription = '';
  bulkMenuOpen = false;
  bulkMenuFile: File | null = null;
  bulkMenuRows: BulkMenuRow[] = [];
  bulkMenuPreviewLoading = false;
  bulkMenuImporting = false;
  bulkMenuMode: 'ADD_NEW' | 'UPDATE_EXISTING' | 'REPLACE' = 'ADD_NEW';
  bulkMenuReplaceConfirmed = false;
  bulkMenuSummary: { totalRows: number; imported: number; updated: number; failed: number; mode: string } | null = null;
  bulkMenuErrorReport = '';
  bulkImageZipFile: File | null = null;
  bulkImageUploading = false;
  bulkImageResult = '';
  bulkImageErrorReport = '';
  newItemPreparationMinutes = 15;
  newItemBestSeller = false;
  newItemChefRecommended = false;
  editingMenuItemId = '';
  newPromotionCode = '';
  newPromotionTitle = '';
  newPromotionDiscount = 10;
  newPromotionMinimum = 0;
  newAdvertisementTitle = '';
  newAdvertisementDescription = '';
  restaurantImageDraft: string | null = null;
  menuImageDrafts: Record<string, string> = {};
  newItemImageData = '';
  newAdminRestaurantName = '';
  newAdminRestaurantCuisine = '';
  newAdminRestaurantAddress = '';
  newAdminRestaurantDescription = '';
  newAdminRestaurantPhone = '';
  newAdminRestaurantEmail = '';
  newAdminRestaurantLatitude: number | null = null;
  newAdminRestaurantLongitude: number | null = null;
  newAdminRestaurantRadiusKm = 5;
  adminRestaurantImageDraft = '';
  adminMenuImageDrafts: Record<string, string> = {};
  newAdminItemName = '';
  newAdminItemCategory = '';
  newAdminItemPrice = 0;
  newAdminItemDescription = '';
  newAdminItemImageData = '';

  constructor(
    private readonly http: HttpClient,
    private readonly changeDetector: ChangeDetectorRef,
    readonly loadingIndicator: LoadingIndicatorService
  ) {}

  get error(): string {
    return this.errorMessage;
  }

  set error(message: string) {
    this.errorMessage = message;
    if (this.errorDismissTimer) {
      clearTimeout(this.errorDismissTimer);
      this.errorDismissTimer = null;
    }
    if (message) {
      this.errorDismissTimer = window.setTimeout(() => {
        this.errorMessage = '';
        this.errorDismissTimer = null;
        this.changeDetector.markForCheck();
      }, 6000);
    }
  }

  ngOnInit(): void {
    this.acceptanceCountdownTimer = window.setInterval(() => {
      this.countdownNow = Date.now();
      if (this.view === 'restaurantPortal') {
        this.changeDetector.markForCheck();
        const hasExpiredPendingOrder = this.restaurantOrders.some((order) =>
          order.status === 'RESTAURANT_PENDING' && order.acceptanceDeadlineAt &&
          Date.parse(order.acceptanceDeadlineAt) <= this.countdownNow
        );
        if (hasExpiredPendingOrder && this.countdownNow >= this.nextExpiredOrderRefreshAt) {
          this.nextExpiredOrderRefreshAt = this.countdownNow + 15_000;
          this.loadRestaurantOrders();
        }
      }
    }, 1000);
    this.applyLocationRoute();
    this.loadBrandLogo();
    if (this.view === 'partnerRegistration') this.restorePartnerRegistration();
    window.addEventListener('popstate', () => {
      this.applyLocationRoute();
      this.changeDetector.markForCheck();
    });
    const savedLatitude = localStorage.getItem(this.deliveryLocationKeys.latitude);
    const savedLongitude = localStorage.getItem(this.deliveryLocationKeys.longitude);
    if (savedLatitude !== null && savedLongitude !== null) {
      const latitude = Number(savedLatitude);
      const longitude = Number(savedLongitude);
      if (this.isCoordinate(latitude, -90, 90) && this.isCoordinate(longitude, -180, 180)) {
        this.deliveryLatitude = latitude;
        this.deliveryLongitude = longitude;
        this.deliveryLocationLabel = localStorage.getItem(this.deliveryLocationKeys.label) || 'Selected delivery location';
      }
    }
    const token = localStorage.getItem(this.tokenKey);
    if (token) {
      this.http.get<{ user: User }>(`${this.api}/auth/me`, { headers: this.headers() }).subscribe({
        next: ({ user }) => {
          this.user = user;
          if (user.role !== 'CUSTOMER') this.restoreGuestCart();
          if (!['partnerRegistration', 'activateRestaurant', 'legal'].includes(this.view)) this.loadRoleLanding();
        },
        error: () => {
          localStorage.removeItem(this.tokenKey);
          this.restoreGuestCart();
          this.loadRestaurants();
        }
      });
    } else {
      this.restoreGuestCart();
      this.loadRestaurants();
    }
  }

  ngOnDestroy(): void {
    if (this.acceptanceCountdownTimer !== null) window.clearInterval(this.acceptanceCountdownTimer);
    if (this.errorDismissTimer) window.clearTimeout(this.errorDismissTimer);
  }

  get cartItems(): { item: MenuItem; quantity: number }[] {
    return this.cartMenu
      .filter((item) => this.cart[item._id] > 0)
      .map((item) => ({ item, quantity: this.cart[item._id] }));
  }

  get subtotal(): number {
    return this.cartItems.reduce((sum, entry) => sum + this.menuPrice(entry.item) * entry.quantity, 0);
  }

  menuPrice(item: MenuItem): number {
    return item.discountPrice !== null && item.discountPrice !== undefined ? item.discountPrice : item.price;
  }

  get cartCount(): number {
    return Object.values(this.cart).reduce((sum, quantity) => sum + quantity, 0);
  }

  get isCustomer(): boolean {
    return this.user?.role === 'CUSTOMER';
  }

  get isRestaurantUser(): boolean {
    return this.user?.role.startsWith('RESTAURANT_') ?? false;
  }

  get isAdminUser(): boolean {
    return this.user?.role === 'ADMIN' || this.user?.role === 'SUPER_ADMIN';
  }

  private roleMatchesLoginPortal(user: User): boolean {
    if (this.loginPortal === 'CUSTOMER') return user.role === 'CUSTOMER';
    if (this.loginPortal === 'RESTAURANT') return user.role.startsWith('RESTAURANT_');
    return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  }

  get isSelectedRestaurantInDeliveryRange(): boolean {
    const restaurant = this.selectedRestaurant;
    if (this.deliveryLatitude === null || this.deliveryLongitude === null ||
        restaurant?.latitude == null || restaurant.longitude == null ||
        restaurant.serviceRadiusKm == null) return false;
    return this.distanceKm(this.deliveryLatitude, this.deliveryLongitude, restaurant.latitude, restaurant.longitude) <= restaurant.serviceRadiusKm;
  }

  get filteredAdminRestaurants(): Restaurant[] {
    const query = this.adminRestaurantSearch.trim().toLowerCase();
    if (!query) return this.adminRestaurants;
    return this.adminRestaurants.filter((restaurant) =>
      [restaurant.name, restaurant.address, restaurant.status, restaurant.availability, ...restaurant.cuisine]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }

  get activeRestaurantOrders(): Order[] {
    return this.restaurantOrders.filter((order) => order.status !== 'CLOSED');
  }

  headers(): HttpHeaders {
    const token = localStorage.getItem(this.tokenKey);
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private showError(error: { error?: { error?: string } }): void {
    this.error = error.error?.error || 'Could not complete that request. Please try again.';
    this.changeDetector.markForCheck();
  }

  private loadBrandLogo(): void {
    this.http.get<{ logoData: string }>(`${this.api}/brand`).subscribe({
      next: ({ logoData }) => {
        this.brandLogoData = logoData || '';
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  loadCustomerTerms(): void {
    this.customerTermsLoading = true;
    this.http.get<CustomerTerms>(`${this.api}/customer-terms`, { headers: this.headers() }).pipe(finalize(() => {
      this.customerTermsLoading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (terms) => {
        if (terms.acceptanceRequired || this.customerTerms?.version !== terms.version) this.customerTermsAccepted = false;
        this.customerTerms = terms;
      },
      error: (error) => this.showError(error)
    });
  }

  openCustomerTerms(): void {
    if (this.customerTerms) this.customerTermsModalOpen = true;
  }

  closeCustomerTerms(): void {
    this.customerTermsModalOpen = false;
  }

  private restorePartnerRegistration(): void {
    const registrationId = sessionStorage.getItem(`${this.partnerAccessPrefix}last-id`) || '';
    if (registrationId) {
      this.loadPartnerRegistrationStatus();
    } else {
      this.partnerRegistrationAccessToken = sessionStorage.getItem(`${this.partnerAccessPrefix}pending-token`) || '';
      this.partnerRequestId = sessionStorage.getItem(`${this.partnerAccessPrefix}request-id`) || '';
    }
  }

  scrollToPartnerForm(): void {
    document.getElementById('partner-registration-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  returnFromLegal(): void {
    this.view = 'partnerRegistration';
    window.history.pushState(null, '', '/partner/register');
  }

  openLegalPage(path: string): void {
    this.legalPage = path.includes('privacy') ? 'privacy' : path.includes('policies') ? 'policies' : path.includes('contact') ? 'contact' : path.includes('about') ? 'about' : 'terms';
    this.view = 'legal';
    window.history.pushState(null, '', path);
  }

  private createPartnerAccessToken(): string {
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private validatePartnerApplication(): boolean {
    const form = this.partnerApplication;
    const errors: Partial<Record<PartnerFormErrorField, string>> = {};
    if (form.restaurantName.trim().length < 2) errors.restaurantName = 'Enter the restaurant or hotel name.';
    if (!form.restaurantType) errors.restaurantType = 'Choose a restaurant type.';
    if (form.primaryCuisine.trim().length < 2) errors.primaryCuisine = 'Enter the primary cuisine.';
    if (form.ownerName.trim().length < 2) errors.ownerName = 'Enter the authorized representative name.';
    const phonePattern = /^\+?[0-9 ()-]{8,20}$/;
    if (!phonePattern.test(form.phone.trim()) || form.phone.replace(/\D/g, '').length < 8 || form.phone.replace(/\D/g, '').length > 15) errors.phone = 'Enter a valid official contact number.';
    if (!phonePattern.test(form.whatsapp.trim()) || form.whatsapp.replace(/\D/g, '').length < 8 || form.whatsapp.replace(/\D/g, '').length > 15) errors.whatsapp = 'Enter a valid WhatsApp number.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid business email.';
    if (form.address.trim().length < 5) errors.address = 'Enter the restaurant address.';
    if (!form.city.trim()) errors.city = 'Enter the city or municipality.';
    if (form.latitude === null || form.longitude === null || form.latitude < 24.4 || form.latitude > 26.2 || form.longitude < 50.7 || form.longitude > 51.8) errors.mapLocation = 'Select the restaurant location on the map within Qatar.';
    if (form.openingTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.openingTime)) errors.openingTime = 'Use 24-hour HH:MM time.';
    if (form.closingTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.closingTime)) errors.closingTime = 'Use 24-hour HH:MM time.';
    if (!Number.isInteger(Number(form.preparationMinutes)) || form.preparationMinutes < 1 || form.preparationMinutes > 360) errors.preparationMinutes = 'Use a whole number from 1 to 360.';
    if (!Number.isInteger(Number(form.estimatedDeliveryMinutes)) || form.estimatedDeliveryMinutes < 1 || form.estimatedDeliveryMinutes > 720) errors.estimatedDeliveryMinutes = 'Use a whole number from 1 to 720.';
    if (!Number.isFinite(Number(form.serviceRadiusKm)) || form.serviceRadiusKm < 0.5 || form.serviceRadiusKm > 100) errors.serviceRadiusKm = 'Enter a radius between 0.5 and 100 km.';
    if (form.extendedDeliveryAvailable && (!form.extendedDeliveryRadiusKm || form.extendedDeliveryRadiusKm < 0.5 || form.extendedDeliveryRadiusKm > 200)) errors.extendedDeliveryRadiusKm = 'Enter an extended radius between 0.5 and 200 km.';
    if (form.minimumOrderValue !== null && form.minimumOrderValue < 0) errors.minimumOrderValue = 'Minimum order cannot be negative.';
    if (form.maximumOrderValue !== null && form.maximumOrderValue < 0) errors.maximumOrderValue = 'Maximum order cannot be negative.';
    if (form.minimumOrderValue !== null && (form.maximumOrderValue ?? 1000) < form.minimumOrderValue) errors.maximumOrderValue = 'Maximum order must be at least the minimum (default QAR 1,000).';
    if (!form.paymentMethods.length) errors.paymentMethods = 'Choose at least one payment method.';
    if (form.deliveryFee !== null && (!Number.isFinite(form.deliveryFee) || form.deliveryFee < 0 || form.deliveryFee > 100000)) errors.deliveryFee = 'Enter a non-negative fee up to QAR 100,000.';
    if (form.freeDeliveryThreshold !== null && (!Number.isFinite(form.freeDeliveryThreshold) || form.freeDeliveryThreshold < 0 || form.freeDeliveryThreshold > 100000)) errors.freeDeliveryThreshold = 'Enter a non-negative threshold up to QAR 100,000.';
    if (!form.declarations.authorized) errors.declaration_authorized = 'Confirm you are authorized to register this restaurant.';
    if (!form.declarations.accurate) errors.declaration_accurate = 'Confirm the information is accurate.';
    if (!form.declarations.terms) errors.declaration_terms = 'Accept the Restaurant Partner Terms.';
    if (!form.declarations.approval) errors.declaration_approval = 'Acknowledge that approval is not guaranteed.';
    if (!form.declarations.adminReview) errors.declaration_adminReview = 'Acknowledge that changes may require Admin review.';
    this.partnerFormErrors = errors;
    return Object.keys(errors).length === 0;
  }

  reviewPartnerApplication(): void {
    this.error = '';
    if (!this.validatePartnerApplication()) {
      this.notice = 'Please review the highlighted fields before continuing.';
      return;
    }
    this.partnerReviewMode = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  togglePartnerPaymentMethod(method: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const methods = this.partnerApplication.paymentMethods.filter((entry) => entry !== method);
    if (checked) methods.push(method);
    this.partnerApplication.paymentMethods = methods;
    this.partnerFormErrors.paymentMethods = '';
  }

  editPartnerApplication(): void {
    this.partnerReviewMode = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  submitPartnerApplication(): void {
    if (this.loading || !this.validatePartnerApplication()) {
      if (!this.loading) this.partnerReviewMode = false;
      return;
    }
    if (!this.partnerRegistrationAccessToken) {
      this.partnerRegistrationAccessToken = this.createPartnerAccessToken();
    }
    if (!this.partnerRequestId) this.partnerRequestId = window.crypto.randomUUID();
    sessionStorage.setItem(`${this.partnerAccessPrefix}pending-token`, this.partnerRegistrationAccessToken);
    sessionStorage.setItem(`${this.partnerAccessPrefix}request-id`, this.partnerRequestId);
    const headers = this.headers()
      .set('X-Registration-Token', this.partnerRegistrationAccessToken)
      .set('Idempotency-Key', this.partnerRequestId);
    const endpoint = this.partnerRegistration
      ? `${this.api}/partner-registrations/${this.partnerRegistration.registrationId}`
      : `${this.api}/partner-registrations`;
    const request = this.partnerRegistration
      ? this.http.patch<{ registration: PartnerRegistration }>(endpoint, { ...this.partnerApplication, termsVersion: this.partnerTermsVersion }, { headers })
      : this.http.post<{ registration: PartnerRegistration }>(endpoint, { ...this.partnerApplication, termsVersion: this.partnerTermsVersion }, { headers });
    this.loading = true;
    request.pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ registration }) => {
        this.partnerRegistration = registration;
        sessionStorage.setItem(`${this.partnerAccessPrefix}${registration.registrationId}`, this.partnerRegistrationAccessToken);
        sessionStorage.setItem(`${this.partnerAccessPrefix}last-id`, registration.registrationId);
        sessionStorage.removeItem(`${this.partnerAccessPrefix}pending-token`);
        sessionStorage.removeItem(`${this.partnerAccessPrefix}request-id`);
        this.partnerReviewMode = false;
        this.partnerFormErrors = {};
        this.notice = 'Thank you for partnering with KABHI! Your registration has been submitted successfully. Our team will review your details and contact you with the next steps.';
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        const fieldErrors = error.error?.fields as Record<string, string> | undefined;
        if (fieldErrors) this.partnerFormErrors = fieldErrors;
        this.showError(error);
      }
    });
  }

  loadPartnerRegistrationStatus(): void {
    const registrationId = this.partnerRegistration?.registrationId || sessionStorage.getItem(`${this.partnerAccessPrefix}last-id`) || '';
    const token = this.partnerRegistrationAccessToken || (registrationId ? sessionStorage.getItem(`${this.partnerAccessPrefix}${registrationId}`) : '') || '';
    if (!registrationId || !token) {
      this.error = 'This browser does not have a saved registration access link.';
      return;
    }
    this.partnerRegistrationAccessToken = token;
    this.http.get<{ registration: PartnerRegistration }>(`${this.api}/partner-registrations/${registrationId}`, {
      headers: this.headers().set('X-Registration-Token', token)
    }).subscribe({
      next: ({ registration }) => {
        this.partnerRegistration = registration;
        if (registration.details) {
          this.partnerApplication = {
            ...registration.details,
            paymentMethods: registration.details.paymentMethods?.length
              ? registration.details.paymentMethods
              : ['CASH_TO_RESTAURANT']
          };
        }
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  async choosePartnerImage(field: 'logoImageData' | 'coverImageData', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.partnerApplication[field] = await this.optimizeImage(file);
      this.partnerFormErrors[field] = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  loadAdminPartnerRegistrations(): void {
    this.http.get<{ registrations: PartnerRegistration[] }>(`${this.api}/admin/partner-registrations`, { headers: this.headers() }).subscribe({
      next: ({ registrations }) => {
        this.adminPartnerRegistrations = registrations;
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  reviewPartnerRegistration(registration: PartnerRegistration, action: string): void {
    this.adminActivationUrl = '';
    this.http.patch<{ registration: PartnerRegistration; activationUrl: string }>(
      `${this.api}/admin/partner-registrations/${registration.registrationId}`,
      { action, reason: this.partnerReviewReasons[registration.registrationId] || '' },
      { headers: this.headers() }
    ).subscribe({
      next: ({ registration: updated, activationUrl }) => {
        this.adminPartnerRegistrations = this.adminPartnerRegistrations.map((entry) => entry.registrationId === updated.registrationId ? updated : entry);
        this.adminActivationUrl = activationUrl;
        this.partnerReviewReasons[updated.registrationId] = '';
        this.notice = action === 'APPROVED' ? `${updated.registrationId} approved. The activation link expires in 7 days.` : `${updated.registrationId}: ${this.statusLabel(updated.status)}.`;
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  loadAdminBrandLogo(): void {
    this.http.get<{ logoData: string }>(`${this.api}/admin/brand`, { headers: this.headers() }).subscribe({
      next: ({ logoData }) => {
        this.brandLogoData = logoData || '';
        this.brandLogoDraft = null;
      },
      error: (error) => this.showError(error)
    });
  }

  loadAdminCustomerTerms(): void {
    this.adminCustomerTermsLoading = true;
    this.http.get<CustomerTerms>(`${this.api}/admin/customer-terms`, { headers: this.headers() }).pipe(finalize(() => {
      this.adminCustomerTermsLoading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (terms) => {
        this.adminCustomerTerms = terms;
        this.adminCustomerTermsDraft = terms.clauses.join('\n');
      },
      error: (error) => this.showError(error)
    });
  }

  saveAdminCustomerTerms(): void {
    const clauses = this.adminCustomerTermsDraft.split(/\r?\n/).map((clause) => clause.trim()).filter(Boolean);
    this.adminCustomerTermsSaving = true;
    this.http.put<CustomerTerms>(`${this.api}/admin/customer-terms`, { clauses }, { headers: this.headers() }).pipe(finalize(() => {
      this.adminCustomerTermsSaving = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (terms) => {
        const changed = terms.version !== this.adminCustomerTerms?.version;
        this.adminCustomerTerms = terms;
        this.adminCustomerTermsDraft = terms.clauses.join('\n');
        this.notice = changed
          ? `Customer Terms and Conditions updated to version ${terms.version}. Customers will be asked to accept the new version at checkout.`
          : 'Customer Terms and Conditions saved; the version is unchanged.';
      },
      error: (error) => this.showError(error)
    });
  }

  async chooseBrandLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.brandLogoDraft = await this.optimizeImage(file);
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this logo.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  saveBrandLogo(): void {
    if (this.brandLogoDraft === null) return;
    this.http.put<{ logoData: string }>(`${this.api}/admin/brand`, { logoData: this.brandLogoDraft }, { headers: this.headers() }).subscribe({
      next: ({ logoData }) => {
        this.brandLogoData = logoData;
        this.brandLogoDraft = null;
        this.notice = 'KABHI branding logo updated.';
      },
      error: (error) => this.showError(error)
    });
  }

  removeBrandLogo(): void {
    this.http.put<{ logoData: string }>(`${this.api}/admin/brand`, { logoData: '' }, { headers: this.headers() }).subscribe({
      next: ({ logoData }) => {
        this.brandLogoData = logoData;
        this.brandLogoDraft = null;
        this.notice = 'The KABHI text logo is now active.';
      },
      error: (error) => this.showError(error)
    });
  }

  activateRestaurantAccount(): void {
    this.loading = true;
    this.http.post<{ token: string; user: User }>(`${this.api}/auth/activate-restaurant`, {
      token: this.activationToken,
      email: this.activationEmail,
      password: this.activationPassword
    }).pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ token, user }) => {
        localStorage.setItem(this.tokenKey, token);
        this.user = user;
        this.notice = 'Your restaurant account is active. Complete your setup and submit your menu for Admin approval.';
        this.loadRoleLanding();
      },
      error: (error) => this.showError(error)
    });
  }

  private loadRoleLanding(): void {
    this.authModalOpen = false;
    window.history.replaceState(null, '', '/');
    if (this.user?.role === 'CUSTOMER') {
      this.view = 'home';
      this.loadFeedbackOrders(false);
      this.loadCustomerAddresses();
      this.loadCustomerCart();
      this.loadRestaurants();
    } else if (this.user?.role.startsWith('RESTAURANT_')) {
      this.loadRestaurantPortal();
    } else if (this.user?.role === 'ADMIN' || this.user?.role === 'SUPER_ADMIN') {
      this.loadAdmin();
    } else {
      this.view = 'home';
      this.loadRestaurants();
    }
  }

  openLogin(portal: LoginPortal): void {
    this.loginPortal = portal;
    this.signupRestaurant = portal === 'RESTAURANT';
    this.authModalView = 'login';
    this.authModalOpen = true;
    this.customerOtpChallengeId = '';
    this.customerOtpCode = '';
    this.customerOtpDevelopmentCode = '';
    this.customerOtpPurpose = 'LOGIN';
    this.error = '';
  }

  closeLogin(): void {
    this.authModalOpen = false;
    if (window.location.pathname.startsWith('/login/')) {
      window.history.replaceState(null, '', '/');
    }
  }

  openSignup(): void {
    if (this.loginPortal === 'ADMIN') return;
    if (this.loginPortal === 'CUSTOMER') {
      this.notice = 'Enter your WhatsApp number and verify the code to create your account.';
      return;
    }
    this.closeLogin();
    this.openPartnerRegistration();
  }

  openPartnerRegistration(): void {
    this.partnerReviewMode = false;
    this.partnerFormErrors = {};
    this.partnerRegistration = null;
    this.view = 'partnerRegistration';
    this.error = '';
    window.history.pushState(null, '', '/partner/register');
    const registrationId = sessionStorage.getItem(`${this.partnerAccessPrefix}last-id`) || '';
    if (registrationId) {
      this.partnerRegistrationAccessToken = sessionStorage.getItem(`${this.partnerAccessPrefix}${registrationId}`) || '';
      this.loadPartnerRegistrationStatus();
    } else {
      this.partnerRegistrationAccessToken = sessionStorage.getItem(`${this.partnerAccessPrefix}pending-token`) || '';
      this.partnerRequestId = sessionStorage.getItem(`${this.partnerAccessPrefix}request-id`) || '';
    }
  }

  navigateHome(): void {
    this.authModalOpen = false;
    if (this.user) {
      this.loadRoleLanding();
      return;
    }
    this.loginPortal = 'CUSTOMER';
    this.signupRestaurant = false;
    this.view = 'home';
    window.history.pushState(null, '', '/');
    this.feedbackBannerDismissed = false;
    this.loadRestaurants();
  }

  private loadFeedbackOrders(redirectToOrders: boolean): void {
    if (!this.user || this.user.role !== 'CUSTOMER') return;
    this.http.get<{ orders: Order[] }>(`${this.api}/orders/mine`, { headers: this.headers() }).subscribe({
      next: ({ orders }) => {
        this.orders = orders;
        this.feedbackSubmitted = Object.fromEntries(
          orders.filter((order) => order.feedbackSubmitted).map((order) => [order._id, true])
        );
        if (redirectToOrders) {
          this.view = 'orders';
          this.openFeedbackModal(this.getUnsubmittedFeedbackOrder(orders) || null);
        } else {
          this.feedbackBannerDismissed = false;
        }
      },
      error: (error) => this.showError(error)
    });
  }

  private getUnsubmittedFeedbackOrder(orders: Order[] = this.orders): Order | null {
    const candidate = orders.filter((order) => order.status === 'CLOSED' && !(this.feedbackSubmitted[order._id] || order.feedbackSubmitted)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return candidate || null;
  }

  get feedbackBannerOrder(): Order | null {
    if (!this.isCustomer || this.view !== 'home') return null;
    return this.getUnsubmittedFeedbackOrder();
  }

  get showFeedbackBanner(): boolean {
    return !this.feedbackBannerDismissed && !!this.feedbackBannerOrder;
  }

  openFeedbackModal(order: Order | null): void {
    if (!order || order.status !== 'CLOSED' || this.feedbackSubmitted[order._id] || order.feedbackSubmitted) return;
    this.feedbackModalOrder = order;
    this.feedbackModalOpen = true;
    this.feedbackBannerDismissed = false;
    const draft = this.getFeedbackDraft(order._id);
    if (!draft.overallRating && !draft.foodRating && !draft.deliveryRating && !draft.comment) {
      this.feedbackDrafts[order._id] = { overallRating: 0, foodRating: 0, deliveryRating: 0, comment: '' };
    }
  }

  closeFeedbackModal(): void {
    this.feedbackModalOpen = false;
    this.feedbackModalOrder = null;
  }

  private applyLocationRoute(): void {
    const route = window.location.pathname.replace(/\/+$/, '') || '/';
    this.authModalOpen = false;
    const portalByRoute: Record<string, LoginPortal> = {
      '/login/customer': 'CUSTOMER',
      '/login/restaurant': 'RESTAURANT',
      '/login/admin': 'ADMIN'
    };
    if (route === '/partner/register') {
      this.view = 'partnerRegistration';
      return;
    }
    if (route === '/activate-restaurant') {
      this.activationToken = new URLSearchParams(window.location.search).get('token') || '';
      this.view = 'activateRestaurant';
      return;
    }
    if (route === '/terms/restaurant-partner' || route === '/privacy' || route === '/policies' || route === '/contact' || route === '/about') {
      this.legalPage = route === '/privacy' ? 'privacy' : route === '/policies' ? 'policies' : route === '/contact' ? 'contact' : route === '/about' ? 'about' : 'terms';
      this.view = 'legal';
      return;
    }
    const portal = portalByRoute[route];
    if (portal) {
      this.loginPortal = portal;
      this.signupRestaurant = portal === 'RESTAURANT';
      this.authModalView = 'login';
      this.authModalOpen = true;
      this.view = 'home';
      return;
    }
    if (route === '/' && !this.user && (this.view === 'login' || this.view === 'signup')) {
      this.loginPortal = 'CUSTOMER';
      this.signupRestaurant = false;
      this.view = 'home';
      this.loadRestaurants();
    }
  }

  loadRestaurants(): void {
    const query = new URLSearchParams();
    if (this.search.trim()) query.set('search', this.search.trim());
    if (this.openOnly) query.set('open', 'true');
    if (this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      query.set('lat', String(this.deliveryLatitude));
      query.set('lng', String(this.deliveryLongitude));
    }
    this.http.get<{ restaurants: Restaurant[]; promotions: Promotion[]; advertisements: Advertisement[] }>(`${this.api}/restaurants?${query.toString()}`, { headers: this.headers() }).subscribe({
      next: (data) => {
        this.restaurants = data.restaurants;
        this.promotions = data.promotions;
        this.advertisements = data.advertisements;
        this.error = '';
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  searchRestaurants(): void {
    this.loadRestaurants();
  }

  chooseLocation(): void {
    if (!navigator.geolocation) {
      this.openMapPicker('delivery');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.changeDeliveryLocation(position.coords.latitude, position.coords.longitude, 'Current location');
        this.notice = 'Nearby restaurants updated for your location.';
        this.loadRestaurants();
      },
      () => {
        this.notice = 'Location permission was not granted. Choose your delivery point on the map instead.';
        this.openMapPicker('delivery');
      },
      { timeout: 8000 }
    );
  }

  openMapPicker(purpose: AppComponent['mapPickerPurpose']): void {
    this.mapPickerPurpose = purpose;
    this.mapPickerOpen = true;
    this.mapSelection = this.savedMapPoint(purpose);
    this.mapSelectionAddress = this.mapSelection
      ? purpose === 'delivery' ? this.deliveryLocationLabel
        : purpose === 'customerAddress' ? this.customerAddressDraft.area
          : purpose === 'signupRestaurant' ? this.signupAddress
            : purpose === 'partnerRegistration' ? this.partnerApplication.address
              : purpose === 'adminCreateRestaurant' ? this.newAdminRestaurantAddress
                : this.adminRestaurant?.address || ''
      : '';
    this.mapError = '';
    this.mapNotice = '';
    this.mapLoading = true;
    this.changeDetector.markForCheck();
    window.setTimeout(() => void this.initializeMapPicker(), 0);
  }

  closeMapPicker(): void {
    this.mapPickerOpen = false;
    this.mapSelectionRequest += 1;
    this.mapPicker?.remove();
    this.mapPicker = null;
    this.mapMarker = null;
    if (this.mapGeocodeTimer) {
      clearTimeout(this.mapGeocodeTimer);
      this.mapGeocodeTimer = null;
    }
  }

  useCurrentLocationInPicker(): void {
    if (!navigator.geolocation) {
      this.mapNotice = 'Location services are unavailable in this browser. Click your location on the map.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        this.mapPicker?.setView([point.lat, point.lng], 15);
        this.setMapSelection(point);
      },
      () => {
        this.mapNotice = 'Location permission was not granted. Click the correct location on the map.';
        this.changeDetector.markForCheck();
      },
      { timeout: 10000 }
    );
  }

  confirmMapSelection(): void {
    if (!this.mapSelection) return;
    const { lat, lng } = this.mapSelection;
    const locationLabel = this.mapSelectionAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (this.mapPickerPurpose === 'delivery') {
      this.changeDeliveryLocation(lat, lng, locationLabel);
      this.notice = 'Showing restaurants that deliver to your selected location.';
      this.loadRestaurants();
      if (this.view === 'cart') this.refreshOrderQuote();
    } else if (this.mapPickerPurpose === 'customerAddress') {
      this.customerAddressDraft.latitude = lat;
      this.customerAddressDraft.longitude = lng;
    } else if (this.mapPickerPurpose === 'signupRestaurant') {
      this.signupLatitude = lat;
      this.signupLongitude = lng;
      this.signupAddress = locationLabel;
    } else if (this.mapPickerPurpose === 'partnerRegistration') {
      this.partnerApplication.latitude = lat;
      this.partnerApplication.longitude = lng;
      this.partnerApplication.address = locationLabel;
    } else if (this.mapPickerPurpose === 'adminCreateRestaurant') {
      this.newAdminRestaurantLatitude = lat;
      this.newAdminRestaurantLongitude = lng;
      this.newAdminRestaurantAddress = locationLabel;
    } else if (this.adminRestaurant) {
      this.adminRestaurant.latitude = lat;
      this.adminRestaurant.longitude = lng;
      this.adminRestaurant.address = locationLabel;
    }
    this.closeMapPicker();
    this.changeDetector.markForCheck();
  }

  private setDeliveryLocation(latitude: number, longitude: number, label: string): void {
    this.deliveryLatitude = latitude;
    this.deliveryLongitude = longitude;
    this.deliveryLocationLabel = label;
    localStorage.setItem(this.deliveryLocationKeys.latitude, String(latitude));
    localStorage.setItem(this.deliveryLocationKeys.longitude, String(longitude));
    localStorage.setItem(this.deliveryLocationKeys.label, label);
  }

  private changeDeliveryLocation(latitude: number, longitude: number, label: string): void {
    const previousLatitude = this.deliveryLatitude;
    const previousLongitude = this.deliveryLongitude;
    const closeAddress = this.nearestAddressWithinDeliveryRadius(latitude, longitude    );
    const selectedAddress = this.customerAddresses.find((address) => address.id === this.selectedCheckoutAddressId);
    const baselineLatitude = selectedAddress?.latitude ?? previousLatitude;
    const baselineLongitude = selectedAddress?.longitude ?? previousLongitude;
    const movedBeyondAddress = baselineLatitude !== null && baselineLongitude !== null &&
      this.distanceKm(latitude, longitude, baselineLatitude, baselineLongitude) > 0.1;

    if (closeAddress) {
      this.applyCheckoutAddress(closeAddress);
    } else if (movedBeyondAddress) {
      this.clearCheckoutAddressFields();
    }
    this.setDeliveryLocation(latitude, longitude, label);
    if (this.view === 'cart') this.refreshOrderQuote();
  }

  private nearestAddressWithinDeliveryRadius(latitude: number, longitude: number): CustomerAddress | null {
    const nearest = this.customerAddresses.reduce<{ address: CustomerAddress; distance: number } | null>((current, address) => {
      if (address.latitude === null || address.longitude === null) return current;
      const distance = this.distanceKm(latitude, longitude, address.latitude, address.longitude);
      return distance <= 0.1 && (!current || distance < current.distance) ? { address, distance } : current;
    }, null);
    return nearest?.address || null;
  }

  private clearCheckoutAddressFields(): void {
    this.selectedCheckoutAddressId = '';
    this.deliveryBuildingNumber = '';
    this.deliveryStreetNumber = '';
    this.deliveryZone = '';
    this.deliveryArea = '';
    this.deliveryFloorNumber = '';
    this.deliveryRoomNumber = '';
    this.deliveryAddressLabelType = 'HOME';
    this.deliveryCustomAddressLabel = '';
  }

  private isCoordinate(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  private distanceKm(latitude1: number, longitude1: number, latitude2: number, longitude2: number): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(latitude2 - latitude1);
    const longitudeDelta = radians(longitude2 - longitude1);
    const a = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async initializeMapPicker(): Promise<void> {
    try {
      if (!this.mapPickerOpen) return;
      const element = document.getElementById('location-picker-map');
      if (!element) throw new Error('The location map could not be initialized. Close it and try again.');
      const center = this.mapInitialPoint();
      this.mapPicker = L.map(element, { zoomControl: true, scrollWheelZoom: false })
        .setView([center.lat, center.lng], this.mapSelection ? 15 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
      }).addTo(this.mapPicker);
      if (this.mapSelection) {
        this.setMapMarker(this.mapSelection);
      }
      this.mapPicker.on('click', (event: L.LeafletMouseEvent) => {
        this.setMapSelection({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
    } catch (error) {
      this.mapError = error instanceof Error ? error.message : 'The OpenStreetMap picker could not be initialized.';
    } finally {
      this.mapLoading = false;
      this.changeDetector.markForCheck();
      window.setTimeout(() => this.mapPicker?.invalidateSize(), 0);
    }
  }

  private mapInitialPoint(): MapPoint {
    return this.savedMapPoint(this.mapPickerPurpose) || { lat: 25.2854, lng: 51.531 };
  }

  private savedMapPoint(purpose: AppComponent['mapPickerPurpose']): MapPoint | null {
    if (purpose === 'delivery' && this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      return { lat: this.deliveryLatitude, lng: this.deliveryLongitude };
    }
    if (purpose === 'customerAddress' && this.customerAddressDraft.latitude !== null && this.customerAddressDraft.longitude !== null) {
      return { lat: this.customerAddressDraft.latitude, lng: this.customerAddressDraft.longitude };
    }
    if (purpose === 'signupRestaurant' && this.signupLatitude !== null && this.signupLongitude !== null) {
      return { lat: this.signupLatitude, lng: this.signupLongitude };
    }
    if (purpose === 'partnerRegistration' && this.partnerApplication.latitude !== null && this.partnerApplication.longitude !== null) {
      return { lat: this.partnerApplication.latitude, lng: this.partnerApplication.longitude };
    }
    if (purpose === 'adminCreateRestaurant' && this.newAdminRestaurantLatitude !== null && this.newAdminRestaurantLongitude !== null) {
      return { lat: this.newAdminRestaurantLatitude, lng: this.newAdminRestaurantLongitude };
    }
    if (purpose === 'adminEditRestaurant' && this.adminRestaurant?.latitude != null && this.adminRestaurant.longitude != null) {
      return { lat: this.adminRestaurant.latitude, lng: this.adminRestaurant.longitude };
    }
    return null;
  }

  private setMapSelection(point: MapPoint): void {
    this.mapSelection = point;
    this.setMapMarker(point);
    this.mapSelectionAddress = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    this.mapError = '';
    this.mapNotice = '';
    const requestId = ++this.mapSelectionRequest;
    if (this.mapGeocodeTimer) clearTimeout(this.mapGeocodeTimer);
    this.mapGeocodeTimer = window.setTimeout(() => {
      void this.reverseGeocodeSelection(point, requestId);
    }, 1100);
    this.changeDetector.markForCheck();
  }

  private setMapMarker(point: MapPoint): void {
    if (!this.mapPicker) return;
    if (this.mapMarker) {
      this.mapMarker.setLatLng([point.lat, point.lng]);
      return;
    }
  this.mapMarker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        className: 'map-selection-pin',
        html: '<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 1C7.72 1 1 7.72 1 16c0 10.5 15 25 15 25s15-14.5 15-25C31 7.72 24.28 1 16 1Z" fill="#0e4037" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>',
        iconSize: [32, 42],
        iconAnchor: [16, 42]
      }),
      title: 'Selected location'
    }).addTo(this.mapPicker);
    

  }

  private async reverseGeocodeSelection(point: MapPoint, requestId: number): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{ display_name?: string }>(
        'https://nominatim.openstreetmap.org/reverse',
        { params: { format: 'jsonv2', lat: String(point.lat), lon: String(point.lng), zoom: '18' } }
      ));
      if (requestId === this.mapSelectionRequest && result.display_name) {
        this.mapSelectionAddress = result.display_name;
      }
    } catch {
      if (requestId === this.mapSelectionRequest) {
        this.mapNotice = 'Could not look up a nearby address. Your map pin is still selected; enter the full address at checkout.';
      }
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  openRestaurant(restaurant: Restaurant): void {
    this.http.get<{ restaurant: Restaurant; items: MenuItem[] }>(`${this.api}/restaurants/${restaurant._id}/menu`).subscribe({
      next: (data) => {
        this.selectedRestaurant = {
          ...data.restaurant,
          distanceKm: this.deliveryLatitude !== null && this.deliveryLongitude !== null &&
            data.restaurant.latitude != null && data.restaurant.longitude != null
            ? Number(this.distanceKm(this.deliveryLatitude, this.deliveryLongitude, data.restaurant.latitude, data.restaurant.longitude).toFixed(2))
            : null
        };
        this.menu = data.items;
        if (sessionStorage.getItem('kahbi.cartRestaurant') === data.restaurant._id) {
          this.cartMenu = data.items;
          this.persistCart();
        }
        this.view = 'restaurant';
        this.error = '';
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  addToCart(item: MenuItem): void {
    if (!this.selectedRestaurant || this.selectedRestaurant.availability !== 'OPEN' || item.availability !== 'AVAILABLE') return;
    if ((this.cart[item._id] || 0) >= 20) return;
    const cartRestaurantId = sessionStorage.getItem('kahbi.cartRestaurant');
    if (cartRestaurantId && cartRestaurantId !== this.selectedRestaurant._id) {
      if (!window.confirm('Your cart has items from another restaurant. Clear it and add this item?')) return;
      this.cart = {};
      this.cartMenu = [];
    }
    sessionStorage.setItem('kahbi.cartRestaurant', this.selectedRestaurant._id);
    if (!this.cartMenu.length || cartRestaurantId !== this.selectedRestaurant._id) this.cartMenu = this.menu;
    this.cart[item._id] = (this.cart[item._id] || 0) + 1;
    this.persistCart();
    this.error = '';
    this.notice = `${item.name} added to your cart.`;
    this.syncCustomerCart();
  }

  setQuantity(itemId: string, quantity: number): void {
    if (quantity < 1) delete this.cart[itemId];
    else this.cart[itemId] = Math.min(20, quantity);
    if (!this.cartCount) {
      this.cartMenu = [];
      sessionStorage.removeItem('kahbi.cartRestaurant');
    }
    this.persistCart();
    this.syncCustomerCart();
    if (this.view === 'cart') this.refreshOrderQuote();
  }

  private syncCustomerCart(): void {
    if (!this.isCustomer) return;
    const items = Object.entries(this.cart)
      .filter(([, quantity]) => quantity > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    const restaurantId = sessionStorage.getItem('kahbi.cartRestaurant') || this.selectedRestaurant?._id;
    this.customerCartSync = this.customerCartSync.catch(() => undefined).then(async () => {
      try {
        await firstValueFrom(this.http.put(
          `${this.api}/customer/cart`,
          { restaurantId, items },
          { headers: this.headers() }
        ));
      } catch (error) {
        this.showError(error as { error?: { error?: string } });
      }
    });
  }

  private persistCart(): void {
    const restaurantId = sessionStorage.getItem('kahbi.cartRestaurant');
    if (!this.cartCount || !restaurantId) {
      localStorage.removeItem(this.cartStorageKey);
      return;
    }
    localStorage.setItem(this.cartStorageKey, JSON.stringify({
      restaurantId,
      items: this.cart
    }));
  }

  private restoreGuestCart(afterLoad?: () => void): void {
    const savedCart = localStorage.getItem(this.cartStorageKey);
    if (!savedCart) return;

    let restaurantId: string;
    let items: Record<string, number>;
    try {
      const parsed: unknown = JSON.parse(savedCart);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Saved cart is invalid.');
      const stored = parsed as { restaurantId?: unknown; items?: unknown };
      if (typeof stored.restaurantId !== 'string' || !stored.restaurantId ||
          typeof stored.items !== 'object' || stored.items === null || Array.isArray(stored.items)) {
        throw new Error('Saved cart is invalid.');
      }
      const storedItems = stored.items as Record<string, unknown>;
      const validItems = Object.entries(storedItems).every(([itemId, quantity]) =>
        !!itemId && Number.isInteger(quantity) && Number(quantity) > 0 && Number(quantity) <= 20
      );
      if (!validItems || !Object.keys(storedItems).length) throw new Error('Saved cart is invalid.');
      restaurantId = stored.restaurantId;
      items = storedItems as Record<string, number>;
    } catch {
      localStorage.removeItem(this.cartStorageKey);
      sessionStorage.removeItem('kahbi.cartRestaurant');
      this.showError({ error: { error: 'Your saved cart could not be restored. Please add your items again.' } });
      return;
    }

    this.cart = items;
    sessionStorage.setItem('kahbi.cartRestaurant', restaurantId);
    this.http.get<{ restaurant: Restaurant; items: MenuItem[] }>(`${this.api}/restaurants/${restaurantId}/menu`).subscribe({
      next: ({ restaurant, items: menuItems }) => {
        this.selectedRestaurant = {
          ...restaurant,
          distanceKm: this.deliveryLatitude !== null && this.deliveryLongitude !== null &&
            restaurant.latitude != null && restaurant.longitude != null
            ? Number(this.distanceKm(this.deliveryLatitude, this.deliveryLongitude, restaurant.latitude, restaurant.longitude).toFixed(2))
            : null
        };
        this.cartMenu = menuItems;
        const itemsById = new Map(menuItems.map((item) => [item._id, item]));
        const unavailableItems = Object.keys(this.cart).filter((itemId) =>
          itemsById.get(itemId)?.availability === 'UNAVAILABLE'
        );
        const restoredCart = Object.fromEntries(
          Object.entries(this.cart).filter(([itemId]) =>
            itemsById.get(itemId)?.availability === 'AVAILABLE'
          )
        );
        if (Object.keys(restoredCart).length !== Object.keys(this.cart).length) {
          this.cart = restoredCart;
          if (!this.cartCount) {
            sessionStorage.removeItem('kahbi.cartRestaurant');
          }
          this.persistCart();
          if (unavailableItems.length) {
            this.notice = 'One or more items are unavailable. Refresh the menu and try again.';
          }
        }
        if (this.isCustomer) this.syncCustomerCart();
        this.changeDetector.markForCheck();
        afterLoad?.();
      },
      error: (error) => this.showError(error)
    });
  }

  private loadCustomerCart(afterLoad?: () => void): void {
    if (!this.isCustomer) return;
    this.http.get<{ cart: CustomerCart | null; removedItems?: boolean }>(
      `${this.api}/customer/cart`,
      { headers: this.headers() }
    ).subscribe({
      next: ({ cart, removedItems }) => {
        if (cart) {
          this.selectedRestaurant = {
            ...cart.restaurant,
            distanceKm: this.deliveryLatitude !== null && this.deliveryLongitude !== null &&
              cart.restaurant.latitude != null && cart.restaurant.longitude != null
              ? Number(this.distanceKm(this.deliveryLatitude, this.deliveryLongitude, cart.restaurant.latitude, cart.restaurant.longitude).toFixed(2))
              : null
          };
          this.cart = Object.fromEntries(cart.items.map(({ _id, quantity }) => [_id, quantity]));
          this.cartMenu = cart.items;
          sessionStorage.setItem('kahbi.cartRestaurant', cart.restaurant._id);
          this.persistCart();
        } else if (removedItems) {
          this.cart = {};
          this.cartMenu = [];
          sessionStorage.removeItem('kahbi.cartRestaurant');
          this.persistCart();
          this.notice = 'Unavailable items were removed from your cart.';
        } else if (this.cartCount && sessionStorage.getItem('kahbi.cartRestaurant')) {
          this.persistCart();
          this.restoreGuestCart();
          this.syncCustomerCart();
        } else if (localStorage.getItem(this.cartStorageKey)) {
          this.restoreGuestCart();
        } else {
          this.cart = {};
          this.cartMenu = [];
          sessionStorage.removeItem('kahbi.cartRestaurant');
          this.persistCart();
        }
        afterLoad?.();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.showError(error);
        afterLoad?.();
      }
    });
  }

  invalidateOrderQuote(): void {
    this.orderQuoteRequest += 1;
    this.orderQuote = null;
    this.orderQuoteLoading = false;
  }

  refreshOrderQuote(): void {
    const requestId = ++this.orderQuoteRequest;
    this.orderQuote = null;
    if (!this.selectedRestaurant || !this.cartItems.length ||
        this.deliveryLatitude === null || this.deliveryLongitude === null) {
      this.orderQuoteLoading = false;
      return;
    }
    this.orderQuoteLoading = true;
    this.http.post<{ quote: OrderQuote }>(`${this.api}/orders/quote`, {
      restaurantId: this.selectedRestaurant._id,
      items: this.cartItems.map(({ item, quantity }) => ({ menuItemId: item._id, quantity })),
      promotionCode: this.promotionCode,
      latitude: this.deliveryLatitude,
      longitude: this.deliveryLongitude
    }, { headers: this.headers() }).pipe(finalize(() => {
      if (requestId === this.orderQuoteRequest) {
        this.orderQuoteLoading = false;
        this.changeDetector.markForCheck();
      }
    })).subscribe({
      next: ({ quote }) => {
        if (requestId !== this.orderQuoteRequest) return;
        this.orderQuote = quote;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        if (requestId === this.orderQuoteRequest) this.showError(error);
      }
    });
  }

  openCart(): void {
    if (!this.isCustomer && this.customerOtpPurpose !== 'ORDER') {
      this.customerOtpChallengeId = '';
      this.customerOtpCode = '';
      this.customerOtpDevelopmentCode = '';
    }
    this.view = 'cart';
    this.error = '';
    const prepareCart = () => {
      const methods = this.selectedRestaurant?.paymentMethods?.length
        ? this.selectedRestaurant.paymentMethods
        : ['CASH_TO_RESTAURANT'];
      this.orderPaymentMethod = methods.includes('CASH_TO_RESTAURANT') ? 'CASH_TO_RESTAURANT' : methods[0];
      this.refreshOrderQuote();
    };
    if (this.isCustomer) {
      this.customerCartSync.then(() => this.loadCustomerCart(prepareCart));
    } else if (sessionStorage.getItem('kahbi.cartRestaurant')) {
      this.restoreGuestCart(prepareCart);
    } else prepareCart();
    if (this.isCustomer) {
      this.loadCustomerTerms();
      this.loadCustomerAddresses();
    }
  }

  loadCustomerAddresses(): void {
    if (!this.isCustomer) return;
    this.http.get<{ addresses: CustomerAddress[]; primaryAddress: CustomerAddress | null }>(`${this.api}/customer/addresses`, { headers: this.headers() }).subscribe({
      next: ({ addresses, primaryAddress }) => {
        this.customerAddresses = addresses;
        if (primaryAddress) {
          const saved = this.customerAddresses.find((address) => address.id === primaryAddress.id);
          if (saved) this.customerAddresses = this.customerAddresses.map((address) => ({ ...address, isPrimary: address.id === saved.id }));
        }
        if (!this.selectedCheckoutAddressId && primaryAddress) {
          const matchingAddress = this.deliveryLatitude !== null && this.deliveryLongitude !== null
            ? this.nearestAddressWithinDeliveryRadius(this.deliveryLatitude, this.deliveryLongitude)
            : null;
          if (matchingAddress) {
            this.applyCheckoutAddress(matchingAddress);
          } else if (this.deliveryLatitude === null && this.deliveryLongitude === null) {
            this.applyCheckoutAddress(primaryAddress);
          }
        }
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  openCustomerAddressManager(): void {
    if (!this.isCustomer) return;
    this.customerAddressFormOpen = false;
    this.loadCustomerAddresses();
    this.view = 'customerAddresses';
    this.error = '';
  }

  resetCustomerAddressDraft(): void {
    this.customerAddressDraft = {
      id: '',
      labelType: 'HOME',
      customLabel: '',
      floorNumber: '',
      roomNumber: '',
      buildingNumber: '',
      streetNumber: '',
      zone: '',
      area: '',
      latitude: null,
      longitude: null,
      isPrimary: false
    };
    this.customerAddressFormOpen = false;
  }

  startCustomerAddressEdit(address?: CustomerAddress): void {
    this.customerAddressFormOpen = true;
    if (address) {
      this.customerAddressDraft = { ...address };
      return;
    }
    this.customerAddressDraft = {
      id: '',
      labelType: 'HOME',
      customLabel: '',
      floorNumber: '',
      roomNumber: '',
      buildingNumber: '',
      streetNumber: '',
      zone: '',
      area: '',
      latitude: null,
      longitude: null,
      isPrimary: false
    };
  }

  openCustomerAddressMap(): void {
    this.openMapPicker('customerAddress');
  }

  saveCustomerAddress(): void {
    if (!this.isCustomer) return;
    const isEditing = !!this.customerAddressDraft.id;
    const payload = {
      labelType: this.customerAddressDraft.labelType,
      customLabel: this.customerAddressDraft.customLabel,
      floorNumber: this.customerAddressDraft.floorNumber,
      roomNumber: this.customerAddressDraft.roomNumber,
      buildingNumber: this.customerAddressDraft.buildingNumber,
      streetNumber: this.customerAddressDraft.streetNumber,
      zone: this.customerAddressDraft.zone,
      area: this.customerAddressDraft.area,
      latitude: this.customerAddressDraft.latitude,
      longitude: this.customerAddressDraft.longitude,
      isPrimary: this.customerAddressDraft.isPrimary
    };
    const request = isEditing
      ? this.http.put<{ address: CustomerAddress }>(`${this.api}/customer/addresses/${this.customerAddressDraft.id}`, payload, { headers: this.headers() })
      : this.http.post<{ address: CustomerAddress }>(`${this.api}/customer/addresses`, payload, { headers: this.headers() });
    request.subscribe({
      next: () => {
        this.resetCustomerAddressDraft();
        this.loadCustomerAddresses();
        this.notice = isEditing ? 'Address updated.' : 'Address saved.';
      },
      error: (error) => this.showError(error)
    });
  }

  deleteCustomerAddress(addressId: string): void {
    if (!addressId || !this.isCustomer) return;
    this.http.delete<{ removedId: string }>(`${this.api}/customer/addresses/${addressId}`, { headers: this.headers() }).subscribe({
      next: () => {
        this.loadCustomerAddresses();
        this.notice = 'Address deleted.';
      },
      error: (error) => this.showError(error)
    });
  }

  setPrimaryCustomerAddress(addressId: string): void {
    if (!addressId || !this.isCustomer) return;
    this.http.post<{ address: CustomerAddress }>(`${this.api}/customer/addresses/${addressId}/primary`, {}, { headers: this.headers() }).subscribe({
      next: () => {
        this.loadCustomerAddresses();
        this.notice = 'Primary address updated.';
      },
      error: (error) => this.showError(error)
    });
  }

  useCustomerAddressForDelivery(address: CustomerAddress): void {
    if (!address) return;
    this.applyCheckoutAddress(address);
    this.view = 'cart';
  }

  selectCheckoutAddress(addressId: string): void {
    this.selectedCheckoutAddressId = addressId;
    const address = this.customerAddresses.find((entry) => entry.id === addressId);
    if (address) this.applyCheckoutAddress(address);
  }

  private applyCheckoutAddress(address: CustomerAddress): void {
    this.selectedCheckoutAddressId = address.id;
    this.deliveryAddressLabelType = address.labelType;
    this.deliveryCustomAddressLabel = address.customLabel;
    this.deliveryBuildingNumber = address.buildingNumber;
    this.deliveryStreetNumber = address.streetNumber;
    this.deliveryZone = address.zone;
    this.deliveryArea = address.area;
    this.deliveryFloorNumber = address.floorNumber;
    this.deliveryRoomNumber = address.roomNumber;
    this.deliveryLatitude = address.latitude;
    this.deliveryLongitude = address.longitude;
    if (this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      this.deliveryLocationLabel = `${address.labelType === 'OTHER' ? address.customLabel : address.labelType.toLowerCase()} delivery point`;
      this.setDeliveryLocation(this.deliveryLatitude, this.deliveryLongitude, this.deliveryLocationLabel);
    } else {
      this.deliveryLocationLabel = '';
      localStorage.removeItem(this.deliveryLocationKeys.latitude);
      localStorage.removeItem(this.deliveryLocationKeys.longitude);
      localStorage.removeItem(this.deliveryLocationKeys.label);
    }
    if (this.view === 'cart') this.refreshOrderQuote();
  }

  private get deliveryAddress(): string {
    return [
      this.deliveryBuildingNumber.trim(),
      this.deliveryStreetNumber.trim(),
      this.deliveryZone.trim() ? `Zone ${this.deliveryZone.trim()}` : '',
      this.deliveryArea.trim(),
      this.deliveryFloorNumber.trim() ? `Floor ${this.deliveryFloorNumber.trim()}` : '',
      this.deliveryRoomNumber.trim() ? `Room ${this.deliveryRoomNumber.trim()}` : ''
    ].filter(Boolean).join(', ');
  }

  private checkoutAddressPayload(): Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      labelType: this.deliveryAddressLabelType,
      customLabel: this.deliveryCustomAddressLabel.trim(),
      floorNumber: this.deliveryFloorNumber.trim(),
      roomNumber: this.deliveryRoomNumber.trim(),
      buildingNumber: this.deliveryBuildingNumber.trim(),
      streetNumber: this.deliveryStreetNumber.trim(),
      zone: this.deliveryZone.trim(),
      area: this.deliveryArea.trim(),
      latitude: this.deliveryLatitude,
      longitude: this.deliveryLongitude,
      isPrimary: true
    };
  }

  placeOrder(): void {
    if (!this.selectedRestaurant || !this.cartItems.length) return;
    if (!this.isCustomer) {
      this.error = 'Verify your WhatsApp number before placing an order.';
      return;
    }
    if (!this.customerTerms || this.customerTermsLoading) {
      this.error = 'Load the current KABHI terms before placing your order.';
      this.loadCustomerTerms();
      return;
    }
    if (this.customerTerms.acceptanceRequired && !this.customerTermsAccepted) {
      this.error = 'Please read and accept the current KABHI Terms and Conditions before placing your order.';
      return;
    }
    if (this.deliveryLatitude === null || this.deliveryLongitude === null) {
      this.error = 'Choose your delivery location on the map first.';
      return;
    }
    if (!this.isSelectedRestaurantInDeliveryRange) {
      this.error = "This restaurant's free-delivery area does not include your selected pin.";
      return;
    }
    if (!this.orderQuote || this.orderQuoteLoading || this.orderQuote.promotionCode !== this.promotionCode.trim().toUpperCase()) {
      this.error = 'Update the order total before confirming your order.';
      this.refreshOrderQuote();
      return;
    }
    const address = this.deliveryAddress ||
      (this.deliveryLatitude !== null && this.deliveryLongitude !== null
        ? `GPS location: ${this.deliveryLatitude}, ${this.deliveryLongitude}`
        : '');
    if (this.deliveryAddressLabelType === 'OTHER' && !this.deliveryCustomAddressLabel.trim()) {
      this.error = 'Enter a name for this address.';
      return;
    }
    const hasDeliveryCoordinates = this.deliveryLatitude !== null && this.deliveryLongitude !== null;
    if (!hasDeliveryCoordinates &&
        ((!this.deliveryBuildingNumber.trim() && !this.deliveryStreetNumber.trim()) ||
          (!this.deliveryZone.trim() && !this.deliveryArea.trim()))) {
      this.error = 'Enter a building or street number and a zone or area for the delivery address.';
      return;
    }
    this.loading = true;
    this.error = '';
    const idempotencyKey = crypto.randomUUID();
    const body: { [key: string]: unknown } = {
      restaurantId: this.selectedRestaurant._id,
      items: this.cartItems.map(({ item, quantity }) => ({ menuItemId: item._id, quantity })),
      address,
      promotionCode: this.promotionCode || undefined,
      paymentMethod: this.orderPaymentMethod,
      customerTermsVersion: this.customerTerms.version,
      customerTermsAccepted: this.customerTerms.acceptanceRequired ? this.customerTermsAccepted : false,
      idempotencyKey
    };
    if (this.saveCheckoutAddress && this.selectedCheckoutAddressId) {
      body['savedAddressId'] = this.selectedCheckoutAddressId;
    }
    if (this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      body['latitude'] = this.deliveryLatitude;
      body['longitude'] = this.deliveryLongitude;
    }
    const addressRequest = this.saveCheckoutAddress
      ? this.selectedCheckoutAddressId
        ? this.http.put<{ address: CustomerAddress }>(
          `${this.api}/customer/addresses/${this.selectedCheckoutAddressId}`,
          this.checkoutAddressPayload(),
          { headers: this.headers() }
        )
        : this.http.post<{ address: CustomerAddress }>(
          `${this.api}/customer/addresses`,
          this.checkoutAddressPayload(),
          { headers: this.headers() }
        )
      : null;
    const placeOrderRequest = addressRequest
      ? addressRequest.pipe(
        switchMap(({ address: savedAddress }) => {
          body['savedAddressId'] = savedAddress.id;
          this.selectedCheckoutAddressId = savedAddress.id;
          return this.http.post<{ order?: Order }>(
            `${this.api}/orders`,
            body,
            { headers: this.headers().set('Idempotency-Key', idempotencyKey) }
          );
        })
      )
      : this.http.post<{ order?: Order }>(
        `${this.api}/orders`,
        body,
        { headers: this.headers().set('Idempotency-Key', idempotencyKey) }
      );
    placeOrderRequest.pipe(
      finalize(() => {
        this.loading = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        if (!response?.order) {
          this.error = 'The order was created, but the server returned an invalid response. Check your order history before retrying.';
          return;
        }
        const { order } = response;
        this.cart = {};
        this.cartMenu = [];
        this.orderQuote = null;
        this.selectedCheckoutAddressId = '';
        this.saveCheckoutAddress = false;
        this.customerAddresses = [];
        this.customerTerms = { ...this.customerTerms!, acceptanceRequired: false };
        this.customerTermsAccepted = false;
        sessionStorage.removeItem('kahbi.cartRestaurant');
        this.persistCart();
        this.trackedOrder = order;
        this.trackReference = order.reference;
        this.trackPhone = this.isCustomer ? this.user?.phone || '' : this.guestPhone;
        this.view = 'confirmation';
        this.notice = `Order ${order.reference} placed successfully. Restaurant notifications are in demo mode.`;
      },
      error: (error: { status?: number; error?: { error?: string; termsVersion?: string } }) => {
        if (error.status === 409 && error.error?.termsVersion) {
          this.customerTermsAccepted = false;
          this.loadCustomerTerms();
          this.error = 'KABHI Terms and Conditions were updated. Please review and accept the latest version before ordering.';
          return;
        }
        this.showError(error);
      }
    });
  }

  trackOrder(): void {
    if (this.isCustomer) {
      this.http.get<{ orders: Order[] }>(`${this.api}/orders/mine`, { headers: this.headers() }).subscribe({
        next: (result) => {
          this.trackedOrder = result.orders.find((order) => order.reference === this.trackReference.trim().toUpperCase()) || null;
          if (this.trackedOrder && this.trackedOrder.status === 'CLOSED' && !(this.feedbackSubmitted[this.trackedOrder._id] || this.trackedOrder.feedbackSubmitted)) {
            this.openFeedbackModal(this.trackedOrder);
          }
          this.error = this.trackedOrder ? '' : 'No order with that reference was found in your account.';
        },
        error: (error) => this.showError(error)
      });
      return;
    }
    this.http.post<{ order: Order }>(`${this.api}/orders/track`, { reference: this.trackReference, phone: this.trackPhone }).subscribe({
      next: ({ order }) => {
        this.trackedOrder = order;
        if (this.trackedOrder && this.trackedOrder.status === 'CLOSED' && !(this.feedbackSubmitted[this.trackedOrder._id] || this.trackedOrder.feedbackSubmitted)) {
          this.openFeedbackModal(this.trackedOrder);
        }
        this.error = '';
        this.notice = '';
      },
      error: (error) => this.showError(error)
    });
  }

  toggleRestaurantPhone(event: MouseEvent, restaurant: Restaurant): void {
    event.stopPropagation();
    this.expandedRestaurantPhoneId = this.expandedRestaurantPhoneId === restaurant._id ? '' : restaurant._id;
  }

  restaurantDirectionsUrl(restaurant: OrderRestaurant): string {
    const destination = restaurant.latitude !== null && restaurant.latitude !== undefined &&
      restaurant.longitude !== null && restaurant.longitude !== undefined
      ? `${restaurant.latitude},${restaurant.longitude}`
      : restaurant.address;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }

  restaurantPhoneLink(phone: string): string {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
  }

  cancelTrackedOrder(): void {
    if (!this.trackedOrder) return;
    const request = this.isCustomer
      ? this.http.post<{ order: Order }>(`${this.api}/orders/${this.trackedOrder._id}/cancel`, {}, { headers: this.headers() })
      : this.http.post<{ order: Order }>(`${this.api}/orders/guest/cancel`, { reference: this.trackedOrder.reference, phone: this.trackPhone });
    request.subscribe({
      next: ({ order }) => {
        this.trackedOrder = order;
        this.notice = 'Your order was cancelled.';
      },
      error: (error) => this.showError(error)
    });
  }

  signIn(): void {
    if (this.loginPortal === 'CUSTOMER') {
      this.requestCustomerOtp('LOGIN');
      return;
    }
    this.http.post<{ token: string; user: User }>(`${this.api}/auth/login`, {
      email: this.authEmail,
      password: this.authPassword,
      portal: this.loginPortal
    }).subscribe({
      next: ({ token, user }) => {
        this.loading = false;
        if (!this.roleMatchesLoginPortal(user)) {
          this.error = 'That account belongs to a different KABHI portal. Choose the matching account type and try again.';
          return;
        }
        localStorage.setItem(this.tokenKey, token);
        this.user = user;
        this.error = '';
        this.notice = `Welcome, ${user.name}.`;
        this.loadRoleLanding();
      },
      error: (error) => {
        this.loading = false;
        this.showError(error);
      }
    });
  }

  requestCustomerOtp(purpose: 'LOGIN' | 'ORDER'): void {
    const phone = purpose === 'ORDER' ? this.guestPhone.trim() : this.customerAuthPhone.trim();
    this.customerOtpDevelopmentCode = '';
    this.loading = true;
    this.error = '';
    this.http.post<{ challengeId: string; message: string; deliveryMode: 'WHATSAPP' | 'DEVELOPMENT'; developmentCode?: string }>(`${this.api}/auth/customer-otp/request`, {
      phone,
      purpose
    }).pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ challengeId, message, developmentCode }) => {
        this.customerOtpChallengeId = challengeId;
        this.customerOtpPurpose = purpose;
        this.customerOtpCode = '';
        this.customerOtpDevelopmentCode = developmentCode || '';
        this.notice = message;
      },
      error: (error) => this.showError(error)
    });
  }

  verifyCustomerOtp(purpose: 'LOGIN' | 'ORDER'): void {
    const phone = purpose === 'ORDER' ? this.guestPhone.trim() : this.customerAuthPhone.trim();
    this.loading = true;
    this.error = '';
    this.http.post<{ token: string; user: User; purpose: 'LOGIN' | 'ORDER' }>(`${this.api}/auth/customer-otp/verify`, {
      challengeId: this.customerOtpChallengeId,
      phone,
      code: this.customerOtpCode.trim()
    }).pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ token, user }) => {
        localStorage.setItem(this.tokenKey, token);
        this.user = user;
        this.customerOtpChallengeId = '';
        this.customerOtpCode = '';
        this.customerOtpDevelopmentCode = '';
        this.error = '';
        if (purpose === 'ORDER') {
          this.notice = 'WhatsApp number verified. Your account is ready; you can now place your order.';
          this.authModalOpen = false;
          this.view = 'cart';
          this.loadCustomerCart(() => this.refreshOrderQuote());
          this.loadCustomerTerms();
        } else {
          this.notice = 'Your WhatsApp number is verified. Welcome to KABHI.';
          this.loadRoleLanding();
        }
      },
      error: (error) => this.showError(error)
    });
  }

  signUp(): void {
    if (!this.signupRestaurant) {
      this.error = 'Customer accounts are created after WhatsApp verification.';
      return;
    }
    if (this.signupRestaurant && (
      this.signupLatitude === null || this.signupLongitude === null ||
      !Number.isFinite(this.signupServiceRadiusKm) || this.signupServiceRadiusKm < 0.5 || this.signupServiceRadiusKm > 100
    )) {
      this.error = 'Select your restaurant location on the map and set a delivery radius from 0.5 to 100 km.';
      return;
    }
    const endpoint = '/auth/register-restaurant';
    const body = {
          ownerName: this.signupName,
          email: this.authEmail,
          password: this.authPassword,
          phone: this.signupPhone,
          restaurantName: this.signupRestaurantName,
          cuisine: this.signupCuisine,
          address: this.signupAddress,
          latitude: this.signupLatitude,
          longitude: this.signupLongitude,
          serviceRadiusKm: this.signupServiceRadiusKm
        };
    this.http.post<{ token: string; user: User; message?: string }>(`${this.api}${endpoint}`, body).subscribe({
      next: ({ token, user, message }) => {
        localStorage.setItem(this.tokenKey, token);
        this.user = user;
        this.notice = message || `Welcome, ${user.name}.`;
        this.error = '';
        this.loadRoleLanding();
      },
      error: (error) => this.showError(error)
    });
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.user = null;
    this.orders = [];
    this.orderQuote = null;
    this.view = 'home';
    this.loginPortal = 'CUSTOMER';
    this.customerOtpChallengeId = '';
    this.customerOtpCode = '';
    this.customerOtpDevelopmentCode = '';
    window.history.replaceState(null, '', '/');
    this.loadRestaurants();
    this.notice = 'You have been signed out.';
  }

  loadMyOrders(): void {
    this.loadFeedbackOrders(true);
  }

  loadRestaurantPortal(): void {
    this.view = 'restaurantPortal';
    this.http.get<{ restaurant: Restaurant }>(`${this.api}/restaurant/me`, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.restaurantPaymentMethods = restaurant.paymentMethods?.length
          ? [...restaurant.paymentMethods]
          : ['CASH_TO_RESTAURANT'];
        this.loadRestaurantOrders();
        if (this.restaurantOrderTab === 'completed') this.loadCompletedRestaurantOrders(this.completedRestaurantOrdersPage);
        this.http.get<{ items: MenuItem[] }>(`${this.api}/restaurant/menu`, { headers: this.headers() }).subscribe({
          next: ({ items }) => (this.restaurantMenu = items),
          error: (error) => this.showError(error)
        });
        this.http.get<{ transactions: BillingRecord[] }>(`${this.api}/restaurant/billing`, { headers: this.headers() }).subscribe({
          next: ({ transactions }) => (this.restaurantBilling = transactions),
          error: (error) => this.showError(error)
        });
      },
      error: (error) => this.showError(error)
    });
  }

  private loadRestaurantOrders(): void {
    this.http.get<{ orders: Order[] }>(`${this.api}/restaurant/orders`, { headers: this.headers() }).subscribe({
      next: ({ orders }) => {
        this.restaurantOrders = orders;
        this.changeDetector.markForCheck();
      },
      error: (error) => this.showError(error)
    });
  }

  orderAcceptanceCountdown(order: Order): string {
    if (!order.acceptanceDeadlineAt) return '—';
    const remainingSeconds = Math.max(0, Math.ceil((Date.parse(order.acceptanceDeadlineAt) - this.countdownNow) / 1000));
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  orderAcceptanceExpired(order: Order): boolean {
    return !!order.acceptanceDeadlineAt && Date.parse(order.acceptanceDeadlineAt) <= this.countdownNow;
  }

  selectRestaurantOrderTab(tab: 'active' | 'completed'): void {
    this.restaurantOrderTab = tab;
    if (tab === 'completed') this.loadCompletedRestaurantOrders(1);
  }

  loadCompletedRestaurantOrders(page = 1): void {
    this.completedRestaurantOrdersLoading = true;
    this.http.get<{
      orders: Order[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`${this.api}/restaurant/completed-orders?page=${page}`, { headers: this.headers() }).subscribe({
      next: (result) => {
        this.completedRestaurantOrders = result.orders;
        this.completedRestaurantOrdersPage = result.page;
        this.completedRestaurantOrdersTotal = result.total;
        this.completedRestaurantOrdersTotalPages = result.totalPages;
        this.completedRestaurantOrdersLoading = false;
      },
      error: (error) => {
        this.completedRestaurantOrdersLoading = false;
        this.showError(error);
      }
    });
  }

  restaurantAction(order: Order, status: string): void {
    this.http.patch<{ order: Order }>(`${this.api}/restaurant/orders/${order._id}/status`, { status }, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `${order.reference} updated.`;
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  changeAvailability(availability: string): void {
    this.http.patch(`${this.api}/restaurant/availability`, { availability }, { headers: this.headers() }).subscribe({
      next: () => this.loadRestaurantPortal(),
      error: (error) => this.showError(error)
    });
  }

  toggleRestaurantPaymentMethod(method: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const methods = this.restaurantPaymentMethods.filter((entry) => entry !== method);
    if (checked) methods.push(method);
    this.restaurantPaymentMethods = methods;
  }

  saveRestaurantPaymentMethods(): void {
    if (!this.restaurantPaymentMethods.length) {
      this.error = 'Select at least one payment method before saving.';
      return;
    }
    if (this.restaurantPaymentMethodsSaving) return;
    this.restaurantPaymentMethodsSaving = true;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/restaurant/me`, {
      paymentMethods: this.restaurantPaymentMethods
    }, { headers: this.headers() }).pipe(finalize(() => {
      this.restaurantPaymentMethodsSaving = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.restaurantPaymentMethods = restaurant.paymentMethods?.length
          ? [...restaurant.paymentMethods]
          : ['CASH_TO_RESTAURANT'];
        this.error = '';
        this.notice = 'Accepted payment methods updated. This applies to new orders; existing orders are unchanged.';
      },
      error: (error) => this.showError(error)
    });
  }

  changeItemAvailability(item: MenuItem, availability: string): void {
    this.http.patch(`${this.api}/restaurant/menu/${item._id}`, { availability }, { headers: this.headers() }).subscribe({
      next: () => this.loadRestaurantPortal(),
      error: (error) => this.showError(error)
    });
  }

  async chooseRestaurantImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.restaurantImageDraft = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  async chooseMenuImage(itemId: string, event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.menuImageDrafts[itemId] = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  async chooseNewItemImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.newItemImageData = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  async chooseAdminRestaurantImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.adminRestaurantImageDraft = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  async chooseAdminMenuImage(itemId: string, event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.adminMenuImageDrafts[itemId] = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  async chooseNewAdminItemImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.newAdminItemImageData = await this.optimizeImage(file);
      this.error = '';
    } catch (error) {
      this.showError({ error: { error: error instanceof Error ? error.message : 'Could not process this image.' } });
    } finally {
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  private async optimizeImage(file: File): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > this.maxSourceImageBytes) {
      throw new Error('Choose an image smaller than 10 MB before optimization.');
    }

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('This image could not be opened. Choose a valid image file.');
    }
    try {
      if (bitmap.width * bitmap.height > this.maxImagePixels) {
        throw new Error('This image has too many pixels. Choose a smaller image.');
      }
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      let width = Math.max(1, Math.round(bitmap.width * scale));
      let height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this image.');

      for (let attempt = 0; attempt < 9; attempt += 1) {
        canvas.width = width;
        canvas.height = height;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const quality = [0.84, 0.72, 0.6][attempt % 3];
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('Your browser could not compress this image.');
        if (blob.size <= this.maxImageBytes) {
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the optimized image.'));
            reader.onerror = () => reject(new Error('Could not read the optimized image.'));
            reader.readAsDataURL(blob);
          });
        }
        if (attempt % 3 === 2) {
          width = Math.max(1, Math.round(width * 0.8));
          height = Math.max(1, Math.round(height * 0.8));
        }
      }
      throw new Error('This image could not be reduced below 256 KB. Choose a simpler or smaller image.');
    } finally {
      bitmap.close();
    }
  }

  saveRestaurantImage(): void {
    if (this.restaurantImageDraft === null) return;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/restaurant/profile/image`, { imageData: this.restaurantImageDraft }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.restaurantImageDraft = null;
        this.notice = 'Restaurant photo saved.';
      },
      error: (error) => this.showError(error)
    });
  }

  removeRestaurantImage(): void {
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/restaurant/profile/image`, { imageData: '' }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.restaurantImageDraft = null;
        this.notice = 'Restaurant photo removed.';
      },
      error: (error) => this.showError(error)
    });
  }

  saveMenuImage(item: MenuItem): void {
    const imageData = this.menuImageDrafts[item._id];
    if (imageData === undefined) return;
    this.updateMenuImage(item, imageData, 'Menu item photo saved.');
  }

  removeMenuImage(item: MenuItem): void {
    this.updateMenuImage(item, '', 'Menu item photo removed.');
  }

  private updateMenuImage(item: MenuItem, imageData: string, notice: string): void {
    this.http.patch<{ item: MenuItem }>(`${this.api}/restaurant/menu/${item._id}`, { imageData }, { headers: this.headers() }).subscribe({
      next: ({ item: updatedItem }) => {
        this.restaurantMenu = this.restaurantMenu.map((entry) => entry._id === updatedItem._id ? updatedItem : entry);
        this.menu = this.menu.map((entry) => entry._id === updatedItem._id ? updatedItem : entry);
        delete this.menuImageDrafts[updatedItem._id];
        this.notice = notice;
      },
      error: (error) => this.showError(error)
    });
  }

  addMenuItem(): void {
    this.http.post<{ item: MenuItem }>(`${this.api}/restaurant/menu`, {
      name: this.newItemName,
      category: this.newItemCategory,
      price: this.newItemPrice,
      description: this.newItemDescription,
      imageData: this.newItemImageData
    }, { headers: this.headers() }).subscribe({
      next: ({ item }) => {
        this.newItemName = '';
        this.newItemCategory = '';
        this.newItemPrice = 0;
        this.newItemDescription = '';
        this.newItemImageData = '';
        this.notice = item.approvalStatus === 'PENDING_REVIEW'
          ? `${item.name} was submitted and is hidden from customers until Admin approval.`
          : `${item.name} was added to the menu.`;
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  downloadMenuTemplate(): void {
    this.http.get(`${this.api}/restaurant/menu/bulk/template`, {
      headers: this.headers(),
      responseType: 'blob'
    }).subscribe({
      next: (file) => this.downloadFile(file, 'kahbi-menu-template.csv', 'text/csv'),
      error: (error) => this.showError(error)
    });
  }

  selectBulkMenuFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    input.value = '';
    if (file && !/\.(csv|xlsx)$/i.test(file.name)) {
      this.error = 'Choose an Excel .xlsx or CSV .csv menu file.';
      return;
    }
    this.bulkMenuFile = file;
    this.bulkMenuRows = [];
    this.bulkMenuSummary = null;
    this.bulkMenuErrorReport = '';
  }

  previewBulkMenu(): void {
    if (!this.bulkMenuFile || this.bulkMenuPreviewLoading) return;
    const form = new FormData();
    form.append('file', this.bulkMenuFile);
    this.bulkMenuPreviewLoading = true;
    this.http.post<{
      rows: BulkMenuRow[];
      totalRows: number;
      validCount: number;
      invalidCount: number;
    }>(`${this.api}/restaurant/menu/bulk/preview`, form, { headers: this.headers() }).pipe(
      finalize(() => {
        this.bulkMenuPreviewLoading = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (result) => {
        this.bulkMenuRows = result.rows;
        this.bulkMenuSummary = null;
        this.bulkMenuErrorReport = '';
        this.bulkMenuReplaceConfirmed = false;
        this.validateBulkMenuRows();
      },
      error: (error) => this.showError(error)
    });
  }

  validateBulkMenuRows(): void {
    const seen = new Map<string, number>();
    for (const row of this.bulkMenuRows) {
      const errors: string[] = [];
      if (!this.selectedRestaurant || row.restaurantId !== this.selectedRestaurant._id) errors.push('Restaurant ID must match your restaurant.');
      if (!row.category.trim()) errors.push('Category is required.');
      if (!row.name.trim()) errors.push('Item Name is required.');
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0 || price > 100000) errors.push('Price must be greater than 0 and no more than 100,000 QAR.');
      const discount = row.discountPrice === '' || row.discountPrice === null ? null : Number(row.discountPrice);
      if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount >= price)) errors.push('Discount price must be 0 or more and less than the regular price.');
      if (row.category.length > 80) errors.push('Category must be 80 characters or fewer.');
      if (row.name.length > 120) errors.push('Item Name must be 120 characters or fewer.');
      if (row.description.length > 1000) errors.push('Item Description must be 1,000 characters or fewer.');
      if (row.itemId.length > 100) errors.push('Item ID must be 100 characters or fewer.');
      if (row.customizationOptions.length > 1000) errors.push('Customization Options must be 1,000 characters or fewer.');
      if ((row.availabilityStart && !row.availabilityEnd) || (!row.availabilityStart && row.availabilityEnd)) errors.push('Enter both availability start and end times, or leave both blank.');
      if ((row.availabilityStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.availabilityStart)) ||
          (row.availabilityEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.availabilityEnd))) errors.push('Availability times must use 24-hour HH:MM format.');
      if (row.availabilityStart && row.availabilityEnd && row.availabilityStart === row.availabilityEnd) errors.push('Availability start and end times cannot be the same.');
      if (row.imageUrl.trim()) {
        try {
          if (new URL(row.imageUrl).protocol !== 'https:') errors.push('Image URL must use HTTPS.');
        } catch {
          errors.push('Enter a valid HTTPS image URL.');
        }
      }
      const identities = [
        ...(row.itemId.trim() ? [`id:${row.itemId.trim().toLowerCase()}`] : []),
        ...(row.category.trim() && row.name.trim() ? [`name:${row.category.trim().toLowerCase()}|${row.name.trim().toLowerCase()}`] : [])
      ];
      const duplicateRow = identities.map((identity) => seen.get(identity)).find(Boolean);
      if (duplicateRow) {
        errors.push(`Duplicate item in this file (first listed on row ${duplicateRow}).`);
      } else {
        for (const identity of identities) seen.set(identity, row.rowNumber);
      }
      row.errors = errors;
    }
  }

  get bulkMenuValidCount(): number {
    return this.bulkMenuRows.filter((row) => row.errors.length === 0).length;
  }

  get bulkMenuInvalidCount(): number {
    return this.bulkMenuRows.length - this.bulkMenuValidCount;
  }

  importBulkMenu(): void {
    if (!this.bulkMenuRows.length || this.bulkMenuImporting) return;
    this.validateBulkMenuRows();
    if (this.bulkMenuMode === 'REPLACE' && (this.bulkMenuInvalidCount > 0 || !this.bulkMenuReplaceConfirmed)) {
      this.error = this.bulkMenuInvalidCount
        ? 'Correct every invalid row before replacing the entire menu.'
        : 'Confirm that you want to replace the entire menu.';
      return;
    }
    this.bulkMenuImporting = true;
    this.http.post<{
      summary: { totalRows: number; imported: number; updated: number; failed: number; mode: string };
      rows: BulkMenuRow[];
      errorReportCsv: string;
    }>(`${this.api}/restaurant/menu/bulk/import`, {
      rows: this.bulkMenuRows,
      mode: this.bulkMenuMode,
      confirmReplace: this.bulkMenuReplaceConfirmed
    }, { headers: this.headers() }).pipe(
      finalize(() => {
        this.bulkMenuImporting = false;
        this.changeDetector.markForCheck();
      })
    ).subscribe({
      next: (result) => {
        this.bulkMenuRows = result.rows;
        this.bulkMenuSummary = result.summary;
        this.bulkMenuErrorReport = result.errorReportCsv;
        this.notice = `${result.summary.imported} new items imported, ${result.summary.updated} items updated, ${result.summary.failed} rows failed.`;
        this.loadRestaurantPortal();
      },
      error: (error) => {
        if (Array.isArray(error.error?.rows)) {
          this.bulkMenuRows = error.error.rows as BulkMenuRow[];
          this.validateBulkMenuRows();
        }
        this.showError(error);
      }
    });
  }

  downloadBulkMenuErrors(): void {
    if (!this.bulkMenuErrorReport) return;
    this.downloadFile(new Blob([`\uFEFF${this.bulkMenuErrorReport}`], { type: 'text/csv;charset=utf-8' }), 'kahbi-menu-upload-errors.csv', 'text/csv');
  }

  downloadBulkImageErrors(): void {
    if (!this.bulkImageErrorReport) return;
    this.downloadFile(new Blob([`\uFEFF${this.bulkImageErrorReport}`], { type: 'text/csv;charset=utf-8' }), 'kahbi-menu-image-errors.csv', 'text/csv');
  }

  selectBulkImageZip(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    input.value = '';
    if (file && !/\.zip$/i.test(file.name)) {
      this.error = 'Choose a ZIP archive containing menu item photos.';
      return;
    }
    this.bulkImageZipFile = file;
    this.bulkImageResult = '';
    this.bulkImageErrorReport = '';
  }

  uploadBulkImageZip(): void {
    if (!this.bulkImageZipFile || this.bulkImageUploading) return;
    const form = new FormData();
    form.append('file', this.bulkImageZipFile);
    this.bulkImageUploading = true;
    this.http.post<{ uploaded: number; failed: number; failedFiles: { fileName: string; error: string }[] }>(
      `${this.api}/restaurant/menu/bulk/images`,
      form,
      { headers: this.headers() }
    ).pipe(finalize(() => {
      this.bulkImageUploading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (result) => {
        this.bulkImageResult = `${result.uploaded} images matched and saved; ${result.failed} files could not be matched.`;
        if (result.failedFiles.length) {
          this.bulkImageErrorReport = [
            '"File","Error"',
            ...result.failedFiles.map((entry) => `"${entry.fileName.replace(/"/g, '""')}","${entry.error.replace(/"/g, '""')}"`)
          ].join('\r\n');
        }
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  private downloadFile(file: Blob, fileName: string, type: string): void {
    const url = URL.createObjectURL(new Blob([file], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  goToRestaurantMenu(): void {
    if (this.view !== 'restaurantPortal') this.loadRestaurantPortal();
    setTimeout(() => document.getElementById('restaurant-menu')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  loadAdmin(): void {
    this.view = 'adminPortal';
    this.loadAdminWhatsappConfig();
    this.loadAdminPartnerRegistrations();
    this.loadAdminBrandLogo();
    this.loadAdminCustomerTerms();
    this.http.get<{
      metrics: { [key: string]: number };
      orders: Order[];
      pendingReview: Restaurant[];
      recentAudit: { action: string; entity: string; createdAt: string }[];
    }>(`${this.api}/admin/summary`, { headers: this.headers() }).subscribe({
      next: (data) => {
        this.metrics = data.metrics;
        this.allOrders = data.orders;
        this.pendingRestaurants = data.pendingReview;
        this.auditLogs = data.recentAudit;
      },
      error: (error) => this.showError(error)
    });
    this.http.get<{ messages: { template: string; status: string; recipient: string }[] }>(`${this.api}/admin/messages`, { headers: this.headers() }).subscribe({
      next: ({ messages }) => (this.messageLogs = messages),
      error: (error) => this.showError(error)
    });
    this.http.get<{ feedback: FeedbackEntry[]; summary: FeedbackSummary }>(`${this.api}/admin/feedback`, { headers: this.headers() }).subscribe({
      next: ({ feedback, summary }) => {
        this.feedbackEntries = feedback;
        this.feedbackSummary = summary;
      },
      error: (error) => this.showError(error)
    });
    this.loadAdminRestaurants();
    this.http.get<{ transactions: BillingRecord[] }>(`${this.api}/admin/billing`, { headers: this.headers() }).subscribe({
      next: ({ transactions }) => (this.billingTransactions = transactions),
      error: (error) => this.showError(error)
    });
    this.http.get<{ customers: CustomerRecord[] }>(`${this.api}/admin/customers`, { headers: this.headers() }).subscribe({
      next: ({ customers }) => (this.customers = customers),
      error: (error) => this.showError(error)
    });
    this.loadAdminRestaurants();
    this.http.get<{ promotions: Promotion[]; advertisements: Advertisement[] }>(`${this.api}/admin/marketing`, { headers: this.headers() }).subscribe({
      next: (data) => {
        this.promotions = data.promotions;
        this.advertisements = data.advertisements;
      },
      error: (error) => this.showError(error)
    });
  }

  loadAdminWhatsappConfig(): void {
    this.http.get<WhatsappConfigStatus>(`${this.api}/admin/whatsapp-config`, { headers: this.headers() }).subscribe({
      next: (status) => {
        this.adminWhatsappStatus = status;
        this.whatsappOtpDeliveryEnabled = status.otpDeliveryEnabled;
        this.whatsappTemplateName = status.templateName;
        this.whatsappLanguage = status.language;
        this.whatsappGraphVersion = status.graphVersion;
      },
      error: (error) => this.showError(error)
    });
  }

  saveAdminWhatsappConfig(): void {
    if (!this.whatsappAccessToken.trim() && !this.adminWhatsappStatus?.accessTokenConfigured) {
      this.error = 'Enter the WhatsApp Cloud API access token.';
      return;
    }
    if (!this.whatsappPhoneNumberId.trim() && !this.adminWhatsappStatus?.phoneNumberIdConfigured) {
      this.error = 'Enter the WhatsApp Phone Number ID from Meta API Setup.';
      return;
    }
    this.loading = true;
    this.error = '';
    this.http.put<{ message: string }>(`${this.api}/admin/whatsapp-config`, {
      accessToken: this.whatsappAccessToken,
      phoneNumberId: this.whatsappPhoneNumberId,
      templateName: this.whatsappTemplateName,
      language: this.whatsappLanguage,
      graphVersion: this.whatsappGraphVersion
    }, { headers: this.headers() }).pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ message }) => {
        this.whatsappAccessToken = '';
        this.whatsappPhoneNumberId = '';
        this.notice = message;
        this.loadAdminWhatsappConfig();
      },
      error: (error) => this.showError(error)
    });
  }

  setWhatsappOtpDelivery(event: Event): void {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    this.loading = true;
    this.error = '';
    this.http.put<{ deliveryEnabled: boolean; message: string }>(`${this.api}/admin/whatsapp-config/otp-delivery`, {
      enabled
    }, { headers: this.headers() }).pipe(finalize(() => {
      this.loading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: ({ deliveryEnabled, message }) => {
        this.whatsappOtpDeliveryEnabled = deliveryEnabled;
        if (this.adminWhatsappStatus) {
          this.adminWhatsappStatus = { ...this.adminWhatsappStatus, otpDeliveryEnabled: deliveryEnabled };
        }
        this.notice = message;
      },
      error: (error) => {
        this.whatsappOtpDeliveryEnabled = this.adminWhatsappStatus?.otpDeliveryEnabled ?? true;
        this.showError(error);
      }
    });
  }

  createAdminRestaurant(): void {
    if (this.newAdminRestaurantLatitude === null || this.newAdminRestaurantLongitude === null ||
        !Number.isFinite(this.newAdminRestaurantRadiusKm) || this.newAdminRestaurantRadiusKm < 0.5 || this.newAdminRestaurantRadiusKm > 100) {
      this.error = 'Choose the restaurant location on the map and enter a delivery radius from 0.5 to 100 km.';
      return;
    }
    this.http.post<{ restaurant: Restaurant }>(`${this.api}/admin/restaurants`, {
      name: this.newAdminRestaurantName,
      cuisine: this.newAdminRestaurantCuisine,
      address: this.newAdminRestaurantAddress,
      description: this.newAdminRestaurantDescription,
      phone: this.newAdminRestaurantPhone,
      email: this.newAdminRestaurantEmail,
      latitude: this.newAdminRestaurantLatitude,
      longitude: this.newAdminRestaurantLongitude,
      serviceRadiusKm: this.newAdminRestaurantRadiusKm
    }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.newAdminRestaurantName = '';
        this.newAdminRestaurantCuisine = '';
        this.newAdminRestaurantAddress = '';
        this.newAdminRestaurantDescription = '';
        this.newAdminRestaurantPhone = '';
        this.newAdminRestaurantEmail = '';
        this.newAdminRestaurantLatitude = null;
        this.newAdminRestaurantLongitude = null;
        this.newAdminRestaurantRadiusKm = 5;
        this.adminRestaurant = restaurant;
        this.adminRestaurantTab = 'details';
        this.adminRestaurantOrders = [];
        this.adminRestaurantOrdersPage = 1;
        this.adminRestaurantOrdersTotal = 0;
        this.adminRestaurantOrdersTotalPages = 0;
        this.adminRestaurantOrdersLoading = false;
        this.adminCuisineDraft = restaurant.cuisine.join(', ');
        this.adminRestaurantImageDraft = '';
        this.adminMenu = [];
        this.adminMenuImageDrafts = {};
        this.view = 'adminRestaurantEditor';
        this.notice = `${restaurant.name} added. Add its menu items here.`;
        this.loadAdminRestaurants();
      },
      error: (error) => this.showError(error)
    });
  }

  openAdminRestaurantList(): void {
    this.view = 'adminRestaurantList';
    this.adminRestaurantSearch = '';
    this.loadAdminRestaurants();
  }

  private loadAdminRestaurants(): void {
    this.http.get<{ restaurants: Restaurant[] }>(`${this.api}/admin/restaurants`, { headers: this.headers() }).subscribe({
      next: ({ restaurants }) => {
        this.adminRestaurants = restaurants;
        if (this.adminRestaurant) {
          this.adminRestaurant = restaurants.find((restaurant) => restaurant._id === this.adminRestaurant?._id) || null;
          this.adminCuisineDraft = this.adminRestaurant?.cuisine.join(', ') || '';
        }
      },
      error: (error) => this.showError(error)
    });
  }

  selectAdminRestaurant(id: string): void {
    this.adminRestaurant = this.adminRestaurants.find((restaurant) => restaurant._id === id) || null;
    this.adminCuisineDraft = this.adminRestaurant?.cuisine.join(', ') || '';
    this.adminRestaurantTab = 'details';
    this.adminRestaurantOrders = [];
    this.adminRestaurantOrdersPage = 1;
    this.adminRestaurantOrdersTotal = 0;
    this.adminRestaurantOrdersTotalPages = 0;
    this.adminRestaurantOrdersLoading = false;
    this.adminRestaurantImageDraft = '';
    this.adminMenuImageDrafts = {};
    this.adminMenu = [];
    if (!this.adminRestaurant) return;
    this.view = 'adminRestaurantEditor';
    this.http.get<{ items: MenuItem[] }>(`${this.api}/admin/restaurants/${this.adminRestaurant._id}/menu`, { headers: this.headers() }).subscribe({
      next: ({ items }) => (this.adminMenu = items),
      error: (error) => this.showError(error)
    });
  }

  selectAdminRestaurantTab(tab: 'details' | 'ordersFeedback'): void {
    this.adminRestaurantTab = tab;
    if (tab === 'ordersFeedback') this.loadAdminRestaurantOrders(1);
  }

  loadAdminRestaurantOrders(page = 1): void {
    if (!this.adminRestaurant) return;
    const restaurantId = this.adminRestaurant._id;
    this.adminRestaurantOrdersLoading = true;
    this.http.get<{
      orders: Order[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`${this.api}/admin/restaurants/${restaurantId}/orders-feedback?page=${page}`, { headers: this.headers() }).subscribe({
      next: (result) => {
        if (this.adminRestaurant?._id !== restaurantId) return;
        this.adminRestaurantOrders = result.orders;
        this.adminRestaurantOrdersPage = result.page;
        this.adminRestaurantOrdersTotal = result.total;
        this.adminRestaurantOrdersTotalPages = result.totalPages;
        this.adminRestaurantOrdersLoading = false;
      },
      error: (error) => {
        if (this.adminRestaurant?._id !== restaurantId) return;
        this.adminRestaurantOrdersLoading = false;
        this.showError(error);
      }
    });
  }

  backToAdminRestaurantList(): void {
    this.view = 'adminRestaurantList';
    this.adminRestaurantImageDraft = '';
    this.adminMenuImageDrafts = {};
    this.loadAdminRestaurants();
  }

  saveAdminRestaurant(): void {
    if (!this.adminRestaurant) return;
    const restaurant = this.adminRestaurant;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/admin/restaurants/${restaurant._id}`, {
      name: restaurant.name,
      cuisine: this.adminCuisineDraft,
      description: restaurant.description,
      address: restaurant.address,
      phone: restaurant.phone || '',
      email: restaurant.email || '',
      preparationMinutes: restaurant.preparationMinutes,
      minOrder: restaurant.minOrder,
      availability: restaurant.availability,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      serviceRadiusKm: restaurant.serviceRadiusKm
    }, { headers: this.headers() }).subscribe({
      next: ({ restaurant: updated }) => {
        this.adminRestaurant = updated;
        this.adminCuisineDraft = updated.cuisine.join(', ');
        this.adminRestaurants = this.adminRestaurants.map((entry) => entry._id === updated._id ? updated : entry);
        this.notice = `${updated.name} details saved.`;
      },
      error: (error) => this.showError(error)
    });
  }

  saveAdminRestaurantImage(): void {
    if (!this.adminRestaurant || !this.adminRestaurantImageDraft) return;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/admin/restaurants/${this.adminRestaurant._id}`, { imageData: this.adminRestaurantImageDraft }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.adminRestaurant = restaurant;
        this.adminCuisineDraft = restaurant.cuisine.join(', ');
        this.adminRestaurants = this.adminRestaurants.map((entry) => entry._id === restaurant._id ? restaurant : entry);
        this.adminRestaurantImageDraft = '';
        this.notice = 'Restaurant photo saved.';
      },
      error: (error) => this.showError(error)
    });
  }

  removeAdminRestaurantImage(): void {
    if (!this.adminRestaurant) return;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/admin/restaurants/${this.adminRestaurant._id}`, { imageData: '' }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.adminRestaurant = restaurant;
        this.adminCuisineDraft = restaurant.cuisine.join(', ');
        this.adminRestaurants = this.adminRestaurants.map((entry) => entry._id === restaurant._id ? restaurant : entry);
        this.adminRestaurantImageDraft = '';
        this.notice = 'Restaurant photo removed.';
      },
      error: (error) => this.showError(error)
    });
  }

  updateAdminRestaurantStatus(status: string): void {
    if (!this.adminRestaurant) return;
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/admin/restaurants/${this.adminRestaurant._id}`, { status }, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.adminRestaurant = restaurant;
        this.adminCuisineDraft = restaurant.cuisine.join(', ');
        this.adminRestaurants = this.adminRestaurants.map((entry) => entry._id === restaurant._id ? restaurant : entry);
        this.notice = `${restaurant.name} marked ${this.statusLabel(status)}.`;
        this.loadAdminRestaurants();
      },
      error: (error) => this.showError(error)
    });
  }

  addAdminMenuItem(): void {
    if (!this.adminRestaurant) return;
    this.http.post<{ item: MenuItem }>(`${this.api}/admin/restaurants/${this.adminRestaurant._id}/menu`, {
      name: this.newAdminItemName,
      category: this.newAdminItemCategory,
      price: this.newAdminItemPrice,
      description: this.newAdminItemDescription,
      imageData: this.newAdminItemImageData
    }, { headers: this.headers() }).subscribe({
      next: ({ item }) => {
        this.adminMenu = [...this.adminMenu, item];
        this.newAdminItemName = '';
        this.newAdminItemCategory = '';
        this.newAdminItemPrice = 0;
        this.newAdminItemDescription = '';
        this.newAdminItemImageData = '';
        this.notice = `${item.name} added to the menu.`;
      },
      error: (error) => this.showError(error)
    });
  }

  saveAdminMenuItem(item: MenuItem): void {
    const imageData = this.adminMenuImageDrafts[item._id];
    const updates: { name: string; category: string; price: number; description: string; availability: string; imageData?: string; active: boolean } = {
      name: item.name,
      category: item.category,
      price: item.price,
      description: item.description,
      availability: item.availability,
      active: item.active !== false
    };
    if (imageData !== undefined) updates.imageData = imageData;
    this.http.patch<{ item: MenuItem }>(`${this.api}/admin/menu/${item._id}`, updates, { headers: this.headers() }).subscribe({
      next: ({ item: updated }) => {
        this.adminMenu = this.adminMenu.map((entry) => entry._id === updated._id ? updated : entry);
        delete this.adminMenuImageDrafts[updated._id];
        this.notice = `${updated.name} updated.`;
      },
      error: (error) => this.showError(error)
    });
  }

  reviewAdminMenuItem(item: MenuItem, approvalStatus: 'APPROVED' | 'REJECTED'): void {
    this.http.patch<{ item: MenuItem }>(`${this.api}/admin/menu/${item._id}`, { approvalStatus }, { headers: this.headers() }).subscribe({
      next: ({ item: updated }) => {
        this.adminMenu = this.adminMenu.map((entry) => entry._id === updated._id ? updated : entry);
        this.notice = `${updated.name} ${approvalStatus === 'APPROVED' ? 'approved for customer menus' : 'rejected'}.`;
      },
      error: (error) => this.showError(error)
    });
  }

  removeAdminMenuImage(item: MenuItem): void {
    this.http.patch<{ item: MenuItem }>(`${this.api}/admin/menu/${item._id}`, { imageData: '' }, { headers: this.headers() }).subscribe({
      next: ({ item: updated }) => {
        this.adminMenu = this.adminMenu.map((entry) => entry._id === updated._id ? updated : entry);
        delete this.adminMenuImageDrafts[updated._id];
        this.notice = `${updated.name} photo removed.`;
      },
      error: (error) => this.showError(error)
    });
  }

  removeAdminMenuItem(item: MenuItem): void {
    this.setAdminMenuItemActive(item, false);
  }

  reactivateAdminMenuItem(item: MenuItem): void {
    this.setAdminMenuItemActive(item, true);
  }

  private setAdminMenuItemActive(item: MenuItem, active: boolean): void {
    this.http.patch<{ item: MenuItem }>(`${this.api}/admin/menu/${item._id}`, { active }, { headers: this.headers() }).subscribe({
      next: ({ item: updated }) => {
        this.adminMenu = this.adminMenu.map((entry) => entry._id === updated._id ? updated : entry);
        this.notice = `${updated.name} ${active ? 'restored to' : 'removed from'} the active menu.`;
      },
      error: (error) => this.showError(error)
    });
  }

  adminOrderAction(order: Order, status: string): void {
    this.http.patch<{ order: Order }>(`${this.api}/admin/orders/${order._id}/status`, { status }, { headers: this.headers() }).subscribe({
      next: ({ order: updated }) => {
        this.allOrders = this.allOrders.map((entry) => entry._id === updated._id ? updated : entry);
        this.notice = `${order.reference} marked ${this.statusLabel(status)}.`;
        this.loadAdmin();
      },
      error: (error) => this.showError(error)
    });
  }

  adminOrderActions(order: Order): { status: string; label: string }[] {
    const actions: Record<string, { status: string; label: string }[]> = {
      RESTAURANT_PENDING: [{ status: 'ACCEPTED', label: 'Accept' }, { status: 'REJECTED', label: 'Reject' }, { status: 'CANCELLED', label: 'Cancel' }],
      ACCEPTED: [{ status: 'PREPARING', label: 'Start preparing' }, { status: 'CANCELLED', label: 'Cancel' }],
      PREPARING: [{ status: 'READY', label: 'Mark ready' }],
      READY: [{ status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }],
      OUT_FOR_DELIVERY: [{ status: 'DELIVERED', label: 'Mark delivered' }],
      DELIVERED: [{ status: 'CLOSED', label: 'Complete order' }]
    };
    return actions[order.status] || [];
  }

  getFeedbackDraft(orderId: string): { overallRating: number; foodRating: number; deliveryRating: number; comment: string } {
    if (!this.feedbackDrafts[orderId]) {
      this.feedbackDrafts[orderId] = { overallRating: 0, foodRating: 0, deliveryRating: 0, comment: '' };
    }
    return this.feedbackDrafts[orderId];
  }

  setFeedbackRating(orderId: string, field: 'overallRating' | 'foodRating' | 'deliveryRating', value: number): void {
    this.feedbackDrafts[orderId] = this.getFeedbackDraft(orderId);
    this.feedbackDrafts[orderId][field] = value;
  }

  submitOrderFeedback(order: Order): void {
    const draft = this.getFeedbackDraft(order._id);
    if (!draft.overallRating || draft.overallRating < 1 || draft.overallRating > 5) {
      this.error = 'Choose an overall star rating before submitting your feedback.';
      return;
    }
    const payload: { overallRating: number; foodRating?: number; deliveryRating?: number; comment?: string } = {
      overallRating: draft.overallRating
    };
    if (draft.foodRating) payload.foodRating = draft.foodRating;
    if (draft.deliveryRating) payload.deliveryRating = draft.deliveryRating;
    if (draft.comment.trim()) payload.comment = draft.comment.trim();
    this.http.post<{ feedback: FeedbackEntry }>(`${this.api}/orders/${order._id}/feedback`, payload, { headers: this.headers() }).subscribe({
      next: () => {
        this.feedbackSubmitted[order._id] = true;
        this.feedbackDrafts[order._id] = { overallRating: 0, foodRating: 0, deliveryRating: 0, comment: '' };
        this.closeFeedbackModal();
        this.notice = `Thanks for your feedback on ${order.restaurantName}.`;
        this.loadMyOrders();
      },
      error: (error) => this.showError(error)
    });
  }

  updateCustomerStatus(customer: CustomerRecord): void {
    const status = customer.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    this.http.patch(`${this.api}/admin/customers/${customer._id}/status`, { status }, { headers: this.headers() }).subscribe({
      next: () => this.loadAdmin(),
      error: (error) => this.showError(error)
    });
  }

  createPromotion(): void {
    this.http.post(`${this.api}/admin/promotions`, {
      code: this.newPromotionCode,
      title: this.newPromotionTitle,
      discountValue: this.newPromotionDiscount,
      minimumOrder: this.newPromotionMinimum,
      discountType: 'PERCENTAGE'
    }, { headers: this.headers() }).subscribe({
      next: () => {
        this.newPromotionCode = '';
        this.newPromotionTitle = '';
        this.loadAdmin();
      },
      error: (error) => this.showError(error)
    });
  }

  togglePromotion(promotion: Promotion): void {
    if (!promotion._id) return;
    this.http.patch(`${this.api}/admin/promotions/${promotion._id}`, { active: !promotion.active }, { headers: this.headers() }).subscribe({
      next: () => this.loadAdmin(),
      error: (error) => this.showError(error)
    });
  }

  createAdvertisement(): void {
    this.http.post(`${this.api}/admin/advertisements`, {
      title: this.newAdvertisementTitle,
      description: this.newAdvertisementDescription
    }, { headers: this.headers() }).subscribe({
      next: () => {
        this.newAdvertisementTitle = '';
        this.newAdvertisementDescription = '';
        this.loadAdmin();
      },
      error: (error) => this.showError(error)
    });
  }

  toggleAdvertisement(advertisement: Advertisement): void {
    this.http.patch(`${this.api}/admin/advertisements/${advertisement._id}`, { active: !advertisement.active }, { headers: this.headers() }).subscribe({
      next: () => this.loadAdmin(),
      error: (error) => this.showError(error)
    });
  }

  reviewRestaurant(restaurant: Restaurant, status: string): void {
    this.http.patch(`${this.api}/admin/restaurants/${restaurant._id}/status`, { status }, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `${restaurant.name} marked ${status.toLowerCase()}.`;
        this.loadAdmin();
      },
      error: (error) => this.showError(error)
    });
  }

  statusLabel(status: string): string {
    return status.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  orderStatusClass(status: string): string {
    return `order-status-${status.toLowerCase().replaceAll('_', '-')}`;
  }

  money(value: number, currency = 'QAR'): string {
    return new Intl.NumberFormat('en-QA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  }
}
