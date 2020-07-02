import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DooyaAccessory } from './dooyaAccessory';

interface QXmitCallback {():void;}
interface requestSlotCallback {():void;}
type RequestTuple = [string, requestSlotCallback];
type XmitTuple = [string, QXmitCallback, number];
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DooyaHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private SerialPort;
  private arduinoPort;
  private requestQueue;
  private requestAvailable = true;
  private requestWait = 200;
  private xmitQueue;
  private xmitAvailable = true;
  private xmitWait = 1000;
  private nowBase = 0;
  public dooyaObjects;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API) {
    this.log.debug('Finished initializing DooyaController platform:', this.config.name);
    this.log.info('Serial Port:', this.config.serialPort);

    this.SerialPort = require('serialport');
    this.arduinoPort = new this.SerialPort(this.config.serialPort, {baudRate: 9600});
    this.xmitWait = this.config.xmitWait;
    this.requestWait = this.config.updateWait;
    this.logTime('requestWait: ' + this.requestWait + ' xmitWait: ' + this.xmitWait);
    this.nowBase = 0;
    this.now();
    this.dooyaObjects = []; // Empty array to start

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  requestUpdateSlot(id: string, callback: requestSlotCallback) {
    if (this.requestQueue === undefined) {
      this.requestQueue = [];
      this.requestAvailable = true;
    }
    const tuple = [id, callback];
    if (this.requestAvailable) {
      this.requestGrant(tuple);
      this.logTime('requestUpdateSlot for ' + id);
    } else {
      // requestAvailable false means a timeout is already active
      this.requestDelete(id);
      this.requestQueue.push(tuple);
      this.logTime('requestUpdateSlot for ' + id + ' Qed at [' + String(this.requestQueue.length-1) + ']');
    }
  }

  requestDelete(id: string) {
    // Remove any previous requests for the same id
    const store: RequestTuple[] = [];
    let tuple;
    
    while (this.requestQueue.length > 0) {
      tuple = this.requestQueue.pop();
      if (tuple[0] !== id) {
        store.push(tuple);
      }
    }
    while (store.length > 0) {
      tuple = <RequestTuple>store.pop();
      this.requestQueue.push(tuple);
    }
  }

  requestGrant(tuple) {
    this.requestSetTimeout(); // Set a new timeout
    tuple[1](); // Callback to inform caller that slot is available
    this.logTime('requestGrant for ' + tuple[0] + ' remaining in the queue ' + this.requestQueue.length);
  }

  requestSetTimeout() {
    if (this.requestWait > 0) {
      setTimeout(this.requestTimeout.bind(this), this.requestWait); 
      this.requestAvailable = false;
    } else {
      this.requestAvailable = true; // Everything is granted immediately if time is 0
    }
  }

  requestTimeout() {
    if (this.requestQueue.length > 0) {  
      const tuple = this.requestQueue.shift();
      this.requestGrant(tuple);
    } else {
      this.requestAvailable = true;
    }
  }

  queueToXmitter(cmd: string, callback: QXmitCallback, channel: number) {
    const tuple = [cmd, callback, channel];

    if (this.xmitQueue === undefined) {
      this.xmitQueue = [];
      this.xmitAvailable = true;
    }
    if (this.xmitAvailable) {
      this.xmit(tuple);
    } else {
      this.xmitQueue.push(tuple);
      this.logTime('Ch ' + tuple[2] + '  Qed[' + (this.xmitQueue.length-1) + ']');
    }
  }

  xmit(tuple) {
    const cmd = String(tuple[0]);
    this.xmitSetTimeout();
    this.arduinoPort.write(cmd + '\n');
    tuple[1](); // Callback to inform caller that command has been sent
    this.logTime('Ch ' + tuple[2] + '  xmit ' + cmd);
  }

  xmitSetTimeout() {
    setTimeout(this.xmitTimeout.bind(this), this.xmitWait); 
    this.xmitAvailable = false;
  }

  xmitTimeout() {
    this.logTime('xmitTimeout');
    if (this.xmitQueue.length > 0) {
      const tuple = this.xmitQueue.shift();
      this.xmit(tuple);
    } else {
      this.xmitAvailable = true;
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    this.log.info('DooyaController platform - discoverDevices');
    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const devices = this.config.shades;

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(this.config.fixedCode + device.channelCode);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        this.dooyaObjects.push(new DooyaAccessory(this, existingAccessory));
        
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        this.dooyaObjects.push(new DooyaAccessory(this, accessory));

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

  }

  setupTransmitterConfig() {

    if (this.config.overrideArduinoConfig) {
      let xmitConfig = '';

      xmitConfig = '!' + this.config.zeroOn;
      xmitConfig += ',' + this.config.zeroOff;
      xmitConfig += '!' + this.config.oneOn;
      xmitConfig += ',' + this.config.oneOff;
      xmitConfig += '!' + this.config.startOfRowOn;
      xmitConfig += ',' + this.config.startOfRowOff;
      xmitConfig += ',' + this.config.endOfRowOff;
      xmitConfig += ',' + this.config.startOfMsgOff;
      xmitConfig += ',' + this.config.dataPin;

      //this.arduinoPort.write(xmitConfig + '\n');
      this.log.info('Transmitter Config: ' + xmitConfig);
    }
  }

  logTime(s: string) {
    this.log.info(String(this.now()) + ': ' + s);
  }

  now(): number {
    const hr = process.hrtime();
    const getTime = Math.floor(hr[0] * 1e6 + hr[1] / 1e3);
    
    if (this.nowBase === 0) {
      this.nowBase = getTime;
      return 0;
    } else {
      return (getTime - this.nowBase) / 1e6;
    }
  }
}