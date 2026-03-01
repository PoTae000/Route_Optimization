export interface TurnInstruction {
  type: string;
  modifier?: string;
  name: string;
  distance: number;
  duration: number;
  location: [number, number];
}

export interface DeliveryRecord {
  id: number;
  pointId: number | string;
  pointName: string;
  address: string;
  status: 'success' | 'skipped';
  timestamp: Date;
  lat: number;
  lng: number;
}

export interface ChargingStation {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance?: number;
  operator?: string;
  connectionTypes?: string[];
  powerKW?: number;
  numberOfPoints?: number;
  status?: string;
  usageCost?: string;
  isOperational?: boolean;
  stopNumber?: number;
  estimatedChargingTime?: number;
}

export interface OilPriceData {
  date: string;
  stations: {
    [key: string]: {
      [fuelType: string]: {
        name: string;
        price: string;
      };
    };
  };
}

export interface RoutePOI {
  id: string;
  type: 'gas' | 'convenience' | 'restaurant' | 'cafe' | 'ev_charging' | 'viewpoint' | 'attraction' | 'temple' | 'park' | 'museum';
  name: string;
  lat: number;
  lng: number;
  routeIndex: number;
  distFromRoute: number;
  distAlongRoute: number;
  tags?: Record<string, string>;
}

export interface RecentSearch {
  name: string;
  address: string;
  lat: number;
  lng: number;
  timestamp: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  distance: number;
  duration: number;
  avoidTolls: boolean;
  createdAt: string;
}

export interface TrafficIncident {
  id: string;
  type: 'accident' | 'construction' | 'road_closed' | 'congestion' | 'hazard' | 'event';
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  title: string;
  description: string;
  lat: number;
  lng: number;
  road: string;
  startTime: Date;
  endTime?: Date;
  delay?: number;
}

export type VehicleType = 'fuel' | 'ev';

// AI Route Planning
export interface AIRouteSuggestionData {
  suggestedOrder: number[];
  reasoning: string;
  clusters: { name: string; points: number[] }[];
  tips: string[];
}

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatContext {
  totalPoints: number;
  completedPoints: number;
  remainingPoints: number;
  hasRoute: boolean;
  isNavigating: boolean;
  routeDistance?: number;
  routeDuration?: number;
  vehicleType?: string;
  pointNames?: string;
}
