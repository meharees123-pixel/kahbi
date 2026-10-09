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
  status: string;
  availability: string;
  ratingAverage: number;
  ratingCount: number;
  distanceKm?: number | null;
  demo?: boolean;
}

interface MenuItem {
  _id: string;
  name: string;
  description: string;
  category: string;
  price: number;
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
    this.http.post<{ token: string; user: User }>(`${this.api}/auth/login`, { email: this.authEmail, password: this.authPassword }).subscribe({
      next: ({ token, user }) => {
        localStorage.setItem(this.tokenKey, token);
        this.user = user;
        this.error = '';
        this.notice = `Welcome, ${user.name}.`;
        this.loadRoleLanding();
      },
      error: (error) => this.showError(error)
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
      description: this.newItemDescription
    }, { headers: this.headers() }).subscribe({
      next: () => {
        this.newItemName = '';
        this.newItemCategory = '';
        this.newItemPrice = 0;
        this.newItemDescription = '';
        this.loadRestaurantPortal();
      },
      error: (error) => this.showError(error)
    });
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
    this.http.get<{ promotions: Promotion[]; advertisements: Advertisement[] }>(`${this.api}/admin/marketing`, { headers: this.headers() }).subscribe({
      next: (data) => {
        this.promotions = data.promotions;
        this.advertisements = data.advertisements;
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
