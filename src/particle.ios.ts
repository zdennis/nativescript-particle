import {
  getDeviceType,
  TNSParticleAPI,
  TNSParticleDevice,
  TNSParticleDeviceType,
  TNSParticleDeviceVariable,
  TNSParticleEvent,
  TNSParticleLoginOptions
} from "./particle.common";

const toJsArray = (nativeArray: NSArray<any>): Array<any> => {
  const result: Array<any> = [];
  if (nativeArray) {
    for (let i = 0; i < nativeArray.count; i++) {
      result.push(nativeArray.objectAtIndex(i));
    }
  }
  return result;
};

const toJsonVariables = (nativeDictionary: NSDictionary<string, string>): Array<TNSParticleDeviceVariable> => {
  const result: Array<TNSParticleDeviceVariable> = [];
  if (nativeDictionary) {
    for (let i = 0; i < nativeDictionary.allKeys.count; i++) {
      const name = nativeDictionary.allKeys.objectAtIndex(i);
      const val = nativeDictionary.valueForKey(name);
      let type;
      switch (val) {
        case "int32":
          type = "INT";
          break;
        case "double":
          type = "DOUBLE";
          break;
        case "string":
          type = "STRING";
          break;
        default:
          console.log(`Unsupported type (${val}), falling back to STRING.`);
          type = "STRING";
      }
      result.push({name, type});
    }
  }
  return result;
};

class MyTNSParticleDevice implements TNSParticleDevice {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  type: TNSParticleDeviceType;
  functions: Array<string>;
  variables: Array<TNSParticleDeviceVariable>;
  eventIds: Map<string /* prefix */, any /* handler id */>;

  constructor(public nativeDevice: ParticleDevice) {
    this.id = nativeDevice.id;
    this.name = nativeDevice.name;
    this.status = nativeDevice.status;
    this.connected = nativeDevice.connected;
    this.type = getDeviceType(nativeDevice.type);
    this.functions = toJsArray(nativeDevice.functions);
    this.variables = toJsonVariables(nativeDevice.variables);
    this.eventIds = new Map();
  }

  rename(name: string): Promise<void> {
    return new Promise<any>((resolve, reject) => {
      this.nativeDevice.renameCompletion(
          name,
          error => error ? reject(error.localizedDescription) : resolve());
    });
  }

  getVariable(name: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.nativeDevice.getVariableCompletion(
          name,
          (result, error) => error ? reject(error.localizedDescription) : resolve(result));
    });
  }

  callFunction(name: string, ...args): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        this.nativeDevice.callFunctionWithArgumentsCompletion(
            name,
            <any>args,
            (resultCode: number, error: NSError) => error ? reject(error.localizedDescription) : resolve(resultCode));
      } catch (e) {
        reject(e);
      }
    });
  }

  subscribe(prefix: string, eventHandler: (event: TNSParticleEvent) => void): void {
    if (this.eventIds.has(prefix)) {
      console.log(`Already subscribed for prefix '${prefix}' - not registering another event handler.`);
      return;
    }

    const id = this.nativeDevice.subscribeToEventsWithPrefixHandler(
        prefix,
        (event: ParticleEvent, error: NSError) => {
          if (!error) {
            event.data && eventHandler({
              prefix,
              event: event.event,
              data: event.data,
              date: event.time,
              deviceID: event.deviceID
            });
          } else {
            console.log(`Error subscribing to event: ${error}`);
          }
        });

    this.eventIds.set(prefix, id);
  }

  unsubscribe(prefix: string): void {
    if (!this.eventIds.has(prefix)) {
      console.log(`No handler registered from prefix '${prefix}' - skipping unsubscribe`);
      return;
    }

    this.nativeDevice.unsubscribeFromEventWithID(this.eventIds.get(prefix));
    this.eventIds.delete(prefix);
  }
}

export class Particle implements TNSParticleAPI {
  private wizardDelegate: ParticleSetupControllerDelegateImpl;
  private eventIds: Map<string /* prefix */, any /* handler id */> = new Map();

  public login(options: TNSParticleLoginOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        ParticleCloud.sharedInstance().loginWithUserPasswordCompletion(
            options.username,
            options.password,
            (error: NSError) => error ? reject(error.localizedDescription) : resolve());
      } catch (e) {
        reject(e);
      }
    });
  }

  public loginWithToken(token: string): void {
    ParticleCloud.sharedInstance().injectSessionAccessToken(token);
  }

  public setOAuthConfig(id: string, secret: string): void {
    ParticleCloud.sharedInstance().oAuthClientId = id;
    ParticleCloud.sharedInstance().oAuthClientSecret = secret;
  }

  public logout(): void {
    ParticleCloud.sharedInstance().logout();
  }

  public isAuthenticated(): boolean {
    return ParticleCloud.sharedInstance().isAuthenticated;
  }

  public accessToken(): string {
    return ParticleCloud.sharedInstance().accessToken;
  }

  public listDevices(): Promise<Array<TNSParticleDevice>> {
    return new Promise<Array<TNSParticleDevice>>((resolve, reject) => {
      ParticleCloud.sharedInstance().getDevices((particleDevices: NSArray<ParticleDevice>, error: NSError) => {
        if (error) {
          reject(error.localizedDescription);
          return;
        }

        const devices = [];
        if (particleDevices) {
          for (let i = 0; i < particleDevices.count; i++) {
            devices.push(new MyTNSParticleDevice(particleDevices.objectAtIndex(i)));
          }
        }
        resolve(devices);
      });
    });
  }

  public publish(name: string, data: string, isPrivate: boolean, ttl: number = 60): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ParticleCloud.sharedInstance().publishEventWithNameDataIsPrivateTtlCompletion(
          name,
          data,
          isPrivate,
          ttl,
          (error => error ? reject(error.localizedDescription) : resolve()));
    });
  }

  public subscribe(prefix: string, eventHandler: (event: TNSParticleEvent) => void): void {
    if (this.eventIds.has(prefix)) {
      console.log(`There's already a handler registered for prefix '${prefix}' - skipping subscribe`);
      return;
    }

    const id = ParticleCloud.sharedInstance().subscribeToAllEventsWithPrefixHandler(
        prefix,
        (event: ParticleEvent, error: NSError) => {
          if (!error) {
            event.data && eventHandler({
              prefix,
              event: event.event,
              data: event.data,
              date: event.time,
              deviceID: event.deviceID
            });
          } else {
            console.log(`Error subscribing to event: ${error}`);
          }
        });

    this.eventIds.set(prefix, id);
  }

  public unsubscribe(prefix: string): void {
    if (!this.eventIds.has(prefix)) {
      console.log(`No handler registered from prefix '${prefix}' - skipping unsubscribe`);
      return;
    }

    ParticleCloud.sharedInstance().unsubscribeFromEventWithID(this.eventIds.get(prefix));
    this.eventIds.delete(prefix);
  }

  public startDeviceSetupWizard(o?: { setupOnly: boolean; }): Promise<boolean> {
    if (!o) {
      o = { setupOnly: false };
    }
    return new Promise<boolean>((resolve, reject) => {
      const setupController = ParticleSetupMainController.new().initWithSetupOnly(o.setupOnly);
      this.wizardDelegate = ParticleSetupControllerDelegateImpl.createWithOwnerAndCallback(new WeakRef(this), (result: boolean) => resolve(result));
      setupController.delegate = <any>this.wizardDelegate;
      UIApplication.sharedApplication.keyWindow.rootViewController.presentViewControllerAnimatedCompletion(setupController, true, null);
    });
  }

  public getDeviceSetupCustomizer(): any {
    return ParticleSetupCustomization.sharedInstance();
  }
}

class ParticleSetupControllerDelegateImpl extends NSObject implements ParticleSetupMainControllerDelegate {
  static ObjCProtocols = [ParticleSetupMainControllerDelegate]; // define our native protocols

  private owner: WeakRef<Particle>;
  private cb: (result: boolean) => void;

  public static new(): ParticleSetupControllerDelegateImpl {
    return <ParticleSetupControllerDelegateImpl>super.new(); // calls new() on the NSObject
  }

  public static createWithOwnerAndCallback(owner: WeakRef<Particle>, callback: (result: boolean) => void): ParticleSetupControllerDelegateImpl {
    const delegate = <ParticleSetupControllerDelegateImpl>ParticleSetupControllerDelegateImpl.new();
    delegate.owner = owner;
    delegate.cb = callback;
    return delegate;
  }

  public particleSetupViewControllerDidFinishWithResultDevice(controller: ParticleSetupMainController, result: ParticleSetupMainControllerResult, device: ParticleDevice): void {
    this.cb && this.cb(result === ParticleSetupMainControllerResult.Success);
  }

  particleSetupViewControllerDidNotSucceeedWithDeviceID(controller: ParticleSetupMainController, deviceID: string): void {
  }
}
