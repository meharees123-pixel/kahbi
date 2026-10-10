import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  restaurantId?: string;
  demo?: boolean;
}

interface Restaurant {
  _id: string;
  name: string;
  hotelName?: string;
  cuisine: string[];
  description: string;
  address: string;
  category: string;
  preparationMinutes: number;
  minOrder: number;
  maxOrder: number;
  status: string;
  availability: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  latitude?: number | null;
  longitude?: number | null;
  serviceRadiusKm?: number | null;
  ratingAverage: number;
  ratingCount: number;
  distanceKm?: number | null;
  demo?: boolean;
}

interface RestaurantProfileDraft {
  name: string;
  hotelName: string;
  cuisine: string;
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number | null;
  phone: string;
  whatsapp: string;
  email: string;
  preparationMinutes: number;
  minOrder: number;
  maxOrder: number;
  category: string;
}

interface MenuItem {
  _id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  preparationMinutes?: number;
  availability: string;
  bestSeller: boolean;
  chefRecommended: boolean;
}

interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface Order {
  _id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
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
  status: string;
  statusHistory: { status: string; createdAt: string }[];
  createdAt: string;
  commissionAmount?: number;
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

@Component({
  selector: 'kahbi-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  private readonly api = 'http://localhost:3000/api';
  private readonly tokenKey = 'kahbi.session';
  view = 'home';
  user: User | null = null;
  restaurants: Restaurant[] = [];
  menu: MenuItem[] = [];
  selectedRestaurant: Restaurant | null = null;
  promotions: Promotion[] = [];
  advertisements: Advertisement[] = [];
  cart: { [id: string]: number } = {};
  orders: Order[] = [];
  restaurantOrders: Order[] = [];
  restaurantMenu: MenuItem[] = [];
  pendingRestaurants: Restaurant[] = [];
  adminRestaurants: Restaurant[] = [];
  adminRestaurantStatus = 'ALL';
  adminRestaurantSearch = '';
  adminRestaurantPage = 1;
  adminRestaurantTotal = 0;
  adminRestaurantTotalPages = 1;
  readonly adminRestaurantPageSize = 50;
  allOrders: Order[] = [];
  metrics: { [key: string]: number } = {};
  messageLogs: { template: string; status: string; recipient: string }[] = [];
  auditLogs: { action: string; entity: string; createdAt: string }[] = [];
  billingTransactions: BillingRecord[] = [];
  restaurantBilling: BillingRecord[] = [];
  customers: CustomerRecord[] = [];
  error = '';
  notice = '';
  loading = false;
  search = '';
  openOnly = false;
  guestName = '';
  guestPhone = '';
  deliveryAddress = '';
  deliveryLatitude: number | null = null;
  deliveryLongitude: number | null = null;
  promotionCode = '';
  trackReference = '';
  trackPhone = '';
  trackedOrder: Order | null = null;
  authEmail = '';
  authPassword = '';
  loginPortal: 'CUSTOMER' | 'RESTAURANT' | 'ADMIN' = 'CUSTOMER';
  signupName = '';
  signupPhone = '';
  signupRestaurant = false;
  signupRestaurantName = '';
  signupCuisine = '';
  signupAddress = '';
  newItemName = '';
  newItemCategory = '';
  newItemPrice = 0;
  newItemDescription = '';
  newItemPreparationMinutes = 15;
  newItemBestSeller = false;
  newItemChefRecommended = false;
  editingMenuItemId = '';
  menuItemDraft = this.emptyMenuItemDraft();
  restaurantProfileDraft: RestaurantProfileDraft = this.emptyRestaurantProfile();
  newPromotionCode = '';
  newPromotionTitle = '';
  newPromotionDiscount = 10;
  newPromotionMinimum = 0;
  newAdvertisementTitle = '';
  newAdvertisementDescription = '';

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    const token = localStorage.getItem(this.tokenKey);
    if (token) {
      this.http.get<{ user: User }>(`${this.api}/auth/me`, { headers: this.headers() }).subscribe({
        next: ({ user }) => {
          this.user = user;
          this.loadRoleLanding();
        },
        error: () => {
          localStorage.removeItem(this.tokenKey);
          this.loadRestaurants();
        }
      });
    } else {
      this.loadRestaurants();
    }
  }

  get cartItems(): { item: MenuItem; quantity: number }[] {
    return this.menu
      .filter((item) => this.cart[item._id] > 0)
      .map((item) => ({ item, quantity: this.cart[item._id] }));
  }

  get subtotal(): number {
    return this.cartItems.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
  }

  get cartCount(): number {
    return Object.values(this.cart).reduce((sum, quantity) => sum + quantity, 0);
  }

  get isCustomer(): boolean {
    return this.user?.role === 'CUSTOMER';
  }

  get isRestaurantUser(): boolean {
    return Boolean(this.user?.role.startsWith('RESTAURANT_'));
  }

  get isAdminUser(): boolean {
    return this.user?.role === 'ADMIN' || this.user?.role === 'SUPER_ADMIN';
  }

  headers(): HttpHeaders {
    const token = localStorage.getItem(this.tokenKey);
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private showError(error: { error?: { error?: string } }): void {
    this.error = error.error?.error || 'Could not complete that request. Please try again.';
  }

  private loadRoleLanding(): void {
    if (this.user?.role === 'CUSTOMER') {
      this.view = 'home';
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

  private emptyRestaurantProfile(): RestaurantProfileDraft {
    return {
      name: '',
      hotelName: '',
      cuisine: '',
      description: '',
      address: '',
      latitude: null,
      longitude: null,
      serviceRadiusKm: null,
      phone: '',
      whatsapp: '',
      email: '',
      preparationMinutes: 35,
      minOrder: 0,
      maxOrder: 1000,
      category: 'Restaurant'
    };
  }

  private emptyMenuItemDraft(): { name: string; category: string; description: string; price: number; availability: string; preparationMinutes: number; bestSeller: boolean; chefRecommended: boolean } {
    return { name: '', category: '', description: '', price: 0, availability: 'AVAILABLE', preparationMinutes: 15, bestSeller: false, chefRecommended: false };
  }

  private setRestaurantProfile(restaurant: Restaurant): void {
    this.restaurantProfileDraft = {
      name: restaurant.name,
      hotelName: restaurant.hotelName || '',
      cuisine: restaurant.cuisine.join(', '),
      description: restaurant.description || '',
      address: restaurant.address,
      latitude: restaurant.latitude ?? null,
      longitude: restaurant.longitude ?? null,
      serviceRadiusKm: restaurant.serviceRadiusKm ?? null,
      phone: restaurant.phone || '',
      whatsapp: restaurant.whatsapp || '',
      email: restaurant.email || '',
      preparationMinutes: restaurant.preparationMinutes,
      minOrder: restaurant.minOrder,
      maxOrder: restaurant.maxOrder || 1000,
      category: restaurant.category || 'Restaurant'
    };
  }

  selectDemoLogin(portal: 'CUSTOMER' | 'RESTAURANT' | 'ADMIN'): void {
    this.loginPortal = portal;
    this.authEmail = portal === 'CUSTOMER'
      ? 'customer@kahbi.demo'
      : portal === 'RESTAURANT'
        ? 'restaurant@kahbi.demo'
        : 'admin@kahbi.demo';
    this.authPassword = 'Demo123!';
  }

  private roleMatchesLoginPortal(user: User): boolean {
    if (this.loginPortal === 'CUSTOMER') return user.role === 'CUSTOMER';
    if (this.loginPortal === 'RESTAURANT') return user.role.startsWith('RESTAURANT_');
    return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  }

  loadRestaurants(): void {
    const query = new URLSearchParams();
    if (this.search.trim()) query.set('search', this.search.trim());
    if (this.openOnly) query.set('open', 'true');
    if (this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      query.set('lat', String(this.deliveryLatitude));
      query.set('lng', String(this.deliveryLongitude));
    }
    this.http.get<{ restaurants: Restaurant[]; promotions: Promotion[]; advertisements: Advertisement[] }>(`${this.api}/restaurants?${query.toString()}`).subscribe({
      next: (data) => {
        this.restaurants = data.restaurants;
        this.promotions = data.promotions;
        this.advertisements = data.advertisements;
        this.error = '';
      },
      error: (error) => this.showError(error)
    });
  }

  searchRestaurants(): void {
    this.loadRestaurants();
  }

  chooseLocation(): void {
    if (!navigator.geolocation) {
      this.notice = 'Location is unavailable in this browser. Enter your delivery address at checkout.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.deliveryLatitude = position.coords.latitude;
        this.deliveryLongitude = position.coords.longitude;
        this.notice = 'Nearby restaurants updated for your location.';
        this.loadRestaurants();
      },
      () => {
        this.notice = 'Location permission was not granted. You can still browse and enter an address manually.';
      },
      { timeout: 8000 }
    );
  }

  openRestaurant(restaurant: Restaurant): void {
    this.http.get<{ restaurant: Restaurant; items: MenuItem[] }>(`${this.api}/restaurants/${restaurant._id}/menu`).subscribe({
      next: (data) => {
        this.selectedRestaurant = data.restaurant;
        this.menu = data.items;
        this.view = 'restaurant';
        this.error = '';
      },
      error: (error) => this.showError(error)
    });
  }

  addToCart(item: MenuItem): void {
    if (!this.selectedRestaurant || this.selectedRestaurant.availability !== 'OPEN' || item.availability !== 'AVAILABLE') return;
    const cartRestaurantId = sessionStorage.getItem('kahbi.cartRestaurant');
    if (cartRestaurantId && cartRestaurantId !== this.selectedRestaurant._id) {
      if (!window.confirm('Your cart has items from another restaurant. Clear it and add this item?')) return;
      this.cart = {};
    }
    sessionStorage.setItem('kahbi.cartRestaurant', this.selectedRestaurant._id);
    this.cart[item._id] = (this.cart[item._id] || 0) + 1;
    this.error = '';
    this.notice = `${item.name} added to your cart.`;
  }

  setQuantity(itemId: string, quantity: number): void {
    if (quantity < 1) delete this.cart[itemId];
    else this.cart[itemId] = Math.min(20, quantity);
  }

  openCart(): void {
    this.view = 'cart';
    this.error = '';
  }

  placeOrder(): void {
    if (!this.selectedRestaurant || !this.cartItems.length) return;
    this.loading = true;
    this.error = '';
    const idempotencyKey = crypto.randomUUID();
    const body: { [key: string]: unknown } = {
      restaurantId: this.selectedRestaurant._id,
      items: this.cartItems.map(({ item, quantity }) => ({ menuItemId: item._id, quantity })),
      address: this.deliveryAddress,
      promotionCode: this.promotionCode || undefined,
      idempotencyKey,
      guestName: this.guestName,
      guestPhone: this.guestPhone
    };
    if (this.deliveryLatitude !== null && this.deliveryLongitude !== null) {
      body['latitude'] = this.deliveryLatitude;
      body['longitude'] = this.deliveryLongitude;
    }
    this.http.post<{ order: Order }>(`${this.api}/orders`, body, { headers: this.headers().set('Idempotency-Key', idempotencyKey) }).subscribe({
      next: ({ order }) => {
        this.loading = false;
        this.cart = {};
        sessionStorage.removeItem('kahbi.cartRestaurant');
        this.trackedOrder = order;
        this.trackReference = order.reference;
        this.trackPhone = this.isCustomer ? this.user?.phone || '' : this.guestPhone;
        this.view = 'track';
        this.notice = `Order ${order.reference} placed. Restaurant notifications are in demo mode.`;
      },
      error: (error) => {
        this.loading = false;
        this.showError(error);
      }
    });
  }

  trackOrder(): void {
    if (this.isCustomer) {
      this.http.get<{ orders: Order[] }>(`${this.api}/orders/mine`, { headers: this.headers() }).subscribe({
        next: (result) => {
          this.trackedOrder = result.orders.find((order) => order.reference === this.trackReference.trim().toUpperCase()) || null;
          this.error = this.trackedOrder ? '' : 'No order with that reference was found in your account.';
        },
        error: (error) => this.showError(error)
      });
      return;
    }
    this.http.post<{ order: Order }>(`${this.api}/orders/track`, { reference: this.trackReference, phone: this.trackPhone }).subscribe({
      next: ({ order }) => {
        this.trackedOrder = order;
        this.error = '';
        this.notice = '';
      },
      error: (error) => this.showError(error)
    });
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
    this.error = '';
    this.loading = true;
    this.http.post<{ token: string; user: User }>(`${this.api}/auth/login`, { email: this.authEmail, password: this.authPassword }).subscribe({
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

  signUp(): void {
    const endpoint = this.signupRestaurant ? '/auth/register-restaurant' : '/auth/register';
    const body = this.signupRestaurant
      ? {
          ownerName: this.signupName,
          email: this.authEmail,
          password: this.authPassword,
          phone: this.signupPhone,
          restaurantName: this.signupRestaurantName,
          cuisine: this.signupCuisine,
          address: this.signupAddress
        }
      : { name: this.signupName, email: this.authEmail, password: this.authPassword, phone: this.signupPhone };
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
    this.view = 'home';
    this.loadRestaurants();
    this.notice = 'You have been signed out.';
  }

  loadMyOrders(): void {
    this.http.get<{ orders: Order[] }>(`${this.api}/orders/mine`, { headers: this.headers() }).subscribe({
      next: ({ orders }) => {
        this.orders = orders;
        this.view = 'orders';
      },
      error: (error) => this.showError(error)
    });
  }

  loadRestaurantPortal(): void {
    this.view = 'restaurantPortal';
    this.http.get<{ restaurant: Restaurant }>(`${this.api}/restaurant/me`, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.setRestaurantProfile(restaurant);
        this.http.get<{ orders: Order[] }>(`${this.api}/restaurant/orders`, { headers: this.headers() }).subscribe({
          next: ({ orders }) => (this.restaurantOrders = orders),
          error: (error) => this.showError(error)
        });
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

  saveRestaurantProfile(): void {
    const body = {
      ...this.restaurantProfileDraft,
      cuisine: this.restaurantProfileDraft.cuisine.split(',').map((entry) => entry.trim()).filter(Boolean)
    };
    this.http.patch<{ restaurant: Restaurant }>(`${this.api}/restaurant/me`, body, { headers: this.headers() }).subscribe({
      next: ({ restaurant }) => {
        this.selectedRestaurant = restaurant;
        this.setRestaurantProfile(restaurant);
        this.notice = 'Restaurant profile saved.';
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

  addMenuItem(): void {
    this.http.post(`${this.api}/restaurant/menu`, {
      name: this.newItemName,
      category: this.newItemCategory,
      price: this.newItemPrice,
      description: this.newItemDescription,
      preparationMinutes: this.newItemPreparationMinutes,
      bestSeller: this.newItemBestSeller,
      chefRecommended: this.newItemChefRecommended
    }, { headers: this.headers() }).subscribe({
      next: () => {
        this.newItemName = '';
        this.newItemCategory = '';
        this.newItemPrice = 0;
        this.newItemDescription = '';
        this.newItemPreparationMinutes = 15;
        this.newItemBestSeller = false;
        this.newItemChefRecommended = false;
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  editMenuItem(item: MenuItem): void {
    this.editingMenuItemId = item._id;
    this.menuItemDraft = {
      name: item.name,
      category: item.category,
      description: item.description || '',
      price: item.price,
      availability: item.availability,
      preparationMinutes: item.preparationMinutes || 15,
      bestSeller: item.bestSeller,
      chefRecommended: item.chefRecommended
    };
  }

  saveMenuItem(item: MenuItem): void {
    this.http.patch(`${this.api}/restaurant/menu/${item._id}`, this.menuItemDraft, { headers: this.headers() }).subscribe({
      next: () => {
        this.editingMenuItemId = '';
        this.menuItemDraft = this.emptyMenuItemDraft();
        this.notice = `${item.name} updated.`;
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  cancelMenuItemEdit(): void {
    this.editingMenuItemId = '';
    this.menuItemDraft = this.emptyMenuItemDraft();
  }

  archiveMenuItem(item: MenuItem): void {
    if (!window.confirm(`Remove ${item.name} from your menu? Existing order records will be kept.`)) return;
    this.http.delete(`${this.api}/restaurant/menu/${item._id}`, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `${item.name} removed from your menu.`;
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
  }

  goToRestaurantMenu(): void {
    if (this.view !== 'restaurantPortal') this.loadRestaurantPortal();
    setTimeout(() => document.getElementById('restaurant-menu')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  loadAdmin(): void {
    this.view = 'adminPortal';
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

  loadAdminRestaurants(): void {
    const query = new URLSearchParams({
      page: String(this.adminRestaurantPage),
      limit: String(this.adminRestaurantPageSize),
      status: this.adminRestaurantStatus
    });
    if (this.adminRestaurantSearch.trim()) query.set('search', this.adminRestaurantSearch.trim());
    this.http.get<{ restaurants: Restaurant[]; total: number; totalPages: number }>(`${this.api}/admin/restaurants?${query.toString()}`, { headers: this.headers() }).subscribe({
      next: (data) => {
        this.adminRestaurants = data.restaurants;
        this.adminRestaurantTotal = data.total;
        this.adminRestaurantTotalPages = data.totalPages;
      },
      error: (error) => this.showError(error)
    });
  }

  setAdminRestaurantStatus(status: string): void {
    this.adminRestaurantStatus = status;
    this.adminRestaurantPage = 1;
    this.loadAdminRestaurants();
  }

  searchAdminRestaurants(): void {
    this.adminRestaurantPage = 1;
    this.loadAdminRestaurants();
  }

  changeAdminRestaurantPage(page: number): void {
    this.adminRestaurantPage = Math.max(1, Math.min(this.adminRestaurantTotalPages, page));
    this.loadAdminRestaurants();
  }

  goToAdminRestaurants(): void {
    this.view = 'adminPortal';
    setTimeout(() => document.getElementById('admin-restaurants')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  updateAdminRestaurantStatus(restaurant: Restaurant, status: string): void {
    if (status !== 'APPROVED' && !window.confirm(`Change ${restaurant.name} status to ${this.statusLabel(status)}?`)) return;
    this.http.patch(`${this.api}/admin/restaurants/${restaurant._id}/status`, { status }, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `${restaurant.name} marked ${this.statusLabel(status)}.`;
        this.loadAdmin();
      },
      error: (error) => this.showError(error)
    });
  }

  updateAdminRestaurantAvailability(restaurant: Restaurant, availability: string): void {
    this.http.patch(`${this.api}/admin/restaurants/${restaurant._id}/availability`, { availability }, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `${restaurant.name} availability set to ${this.statusLabel(availability)}.`;
        this.loadAdminRestaurants();
      },
      error: (error) => this.showError(error)
    });
  }

  rateOrder(order: Order, stars: number): void {
    this.http.post(`${this.api}/orders/${order._id}/rating`, { stars }, { headers: this.headers() }).subscribe({
      next: () => {
        this.notice = `Thanks for rating ${order.restaurantName}.`;
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

  money(value: number, currency = 'QAR'): string {
    return new Intl.NumberFormat('en-QA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  }
}
