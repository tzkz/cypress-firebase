import * as admin from 'firebase-admin'; // NOTE: Only used for types
import {
  FixtureData,
  FirestoreAction,
  RTDBAction,
  CallRtdbOptions,
  CallFirestoreOptions,
} from './attachCustomCommands';
import {
  slashPathToFirestoreRef,
  deleteCollection,
  isDocPath,
} from './firebase-utils';

/**
 * @param baseRef - Base RTDB reference
 * @param options - Options for ref
 * @returns RTDB Reference
 */
function optionsToRtdbRef(baseRef: any, options?: CallRtdbOptions): any {
  let newRef = baseRef;
  const optionsToAdd = [
    'orderByChild',
    'orderByKey',
    'orderByValue',
    'equalTo',
    'limitToFirst',
    'limitToLast',
    'startAt',
    'endAt',
  ];
  // TODO: Switch to reduce over options keys with baseRef as acc
  optionsToAdd.forEach((optionName: string) => {
    if (options && (options as any)[optionName]) {
      newRef = newRef[optionName]((options as any)[optionName]);
    }
  });
  return newRef;
}

/**
 * @param dataVal - Value of data
 * @param firestoreStatics - Statics from firestore instance
 * @returns Value converted into timestamp object if possible
 */
function convertValueToTimestampOrGeoPointIfPossible(
  dataVal: any,
  firestoreStatics: typeof admin.firestore,
): admin.firestore.FieldValue {
  /* eslint-disable-next-line no-underscore-dangle */
  if (dataVal?._methodName === 'FieldValue.serverTimestamp') {
    return firestoreStatics.FieldValue.serverTimestamp();
  }
  if (
    typeof dataVal?.seconds === 'number' &&
    typeof dataVal?.nanoseconds === 'number'
  ) {
    return new firestoreStatics.Timestamp(dataVal.seconds, dataVal.nanoseconds);
  }
  if (
    typeof dataVal?.latitude === 'number' &&
    typeof dataVal?.longitude === 'number'
  ) {
    return new firestoreStatics.GeoPoint(dataVal.latitude, dataVal.longitude);
  }

  return dataVal;
}

/**
 * @param data - Data to be set in firestore
 * @param firestoreStatics - Statics from Firestore object
 * @returns Data to be set in firestore with timestamp
 */
function getDataWithTimestampsAndGeoPoints(
  data: admin.firestore.DocumentData,
  firestoreStatics: typeof admin.firestore,
): Record<string, any> {
  // Exit if no statics are passed
  if (!firestoreStatics) {
    return data;
  }
  return Object.entries(data).reduce((acc, [currKey, currData]) => {
    // Convert nested timestamp if item is an object
    if (
      typeof currData === 'object' &&
      currData !== null &&
      !Array.isArray(currData) &&
      /* eslint-disable-next-line no-underscore-dangle */
      !currData._methodName &&
      !currData.seconds &&
      !(currData.latitude && currData.longitude)
    ) {
      return {
        ...acc,
        [currKey]: getDataWithTimestampsAndGeoPoints(
          currData,
          firestoreStatics,
        ),
      };
    }
    const value = Array.isArray(currData)
      ? currData.map((dataItem) =>
          convertValueToTimestampOrGeoPointIfPossible(
            dataItem,
            firestoreStatics,
          ),
        )
      : convertValueToTimestampOrGeoPointIfPossible(currData, firestoreStatics);

    return {
      ...acc,
      [currKey]: value,
    };
  }, {});
}

/**
 * @param adminInstance - firebase-admin instance
 * @param action - Action to run
 * @param actionPath - Path in RTDB
 * @param options - Query options
 * @param data - Data to pass to action
 * @returns Promise which resolves with results of calling RTDB
 */
export function callRtdb(
  adminInstance: any,
  action: RTDBAction,
  actionPath: string,
  options?: CallRtdbOptions,
  data?: FixtureData | string | boolean,
): Promise<any> {
  /**
   * @param err - Error to handle
   * @returns Promise which rejects
   */
  function handleError(err: Error): Promise<any> {
    /* eslint-disable no-console */
    console.error(
      `cypress-firebase: Error with RTDB "${action}" at path "${actionPath}" :`,
      err,
    );
    /* eslint-enable no-console */
    return Promise.reject(err);
  }
  if (action === 'get') {
    return optionsToRtdbRef(adminInstance.database().ref(actionPath), options)
      .once('value')
      .then((snap: admin.database.DataSnapshot): any => snap.val())
      .catch(handleError);
  }

  if (action === 'push') {
    const pushRef = adminInstance.database().ref(actionPath).push();
    return pushRef
      .set(data)
      .then(() => pushRef.key)
      .catch(handleError);
  }

  // Delete action
  const actionNameMap = {
    delete: 'remove',
  };
  const cleanedActionName = (actionNameMap as any)[action] || action;
  return adminInstance
    .database()
    .ref(actionPath)
    [cleanedActionName](data)
    .then(
      () =>
        // Prevents Cypress error with message:
        // "You must return a promise, a value, or null to indicate that the task was handled."
        null,
    )
    .catch(handleError);
}

/**
 * @param adminInstance - firebase-admin instance
 * @param action - Action to run
 * @param actionPath - Path to collection or document within Firestore
 * @param options - Query options
 * @param data - Data to pass to action
 * @returns Promise which resolves with results of calling Firestore
 */
export function callFirestore(
  adminInstance: admin.app.App,
  action: FirestoreAction,
  actionPath: string,
  options?: CallFirestoreOptions,
  data?: FixtureData,
): Promise<any> {
  /**
   * @param err - Error to handle
   * @returns Promise which rejects
   */
  function handleError(err: Error): Promise<any> {
    /* eslint-disable no-console */
    console.error(
      `cypress-firebase: Error with Firestore "${action}" at path "${actionPath}" :`,
      err,
    );
    /* eslint-enable no-console */
    return Promise.reject(err);
  }
  if (action === 'get') {
    return (slashPathToFirestoreRef(
      adminInstance.firestore(),
      actionPath,
      options,
    ) as any)
      .get()
      .then((snap: any) => {
        if (snap && snap.docs?.length && typeof snap.docs.map === 'function') {
          return snap.docs.map(
            (docSnap: FirebaseFirestore.DocumentSnapshot) => ({
              ...docSnap.data(),
              id: docSnap.id,
            }),
          );
        }
        // Falling back to null in the case of falsey value prevents Cypress error with message:
        // "You must return a promise, a value, or null to indicate that the task was handled."
        return (snap && typeof snap.data === 'function' && snap.data()) || null;
      })
      .catch(handleError);
  }

  if (action === 'delete') {
    // Handle deleting of collections & sub-collections if not a doc path
    const deletePromise = isDocPath(actionPath)
      ? (slashPathToFirestoreRef(
          adminInstance.firestore(),
          actionPath,
          options,
        ) as FirebaseFirestore.DocumentReference).delete()
      : deleteCollection(
          adminInstance.firestore(),
          actionPath,
          options?.batchSize,
        );
    return (
      deletePromise
        // Returning null in the case of falsey value prevents Cypress error with message:
        // "You must return a promise, a value, or null to indicate that the task was handled."
        .then(() => null)
        .catch(handleError)
    );
  }

  if (!data) {
    throw new Error(`You must define data to run ${action} in firestore.`);
  }

  const dataToSet = getDataWithTimestampsAndGeoPoints(
    data,
    // Use static option if passed (tests), otherwise fallback to statics on adminInstance
    // Tests do not have statics since they are using @firebase/testing
    options?.statics || (adminInstance.firestore as typeof admin.firestore),
  );

  if (action === 'set') {
    return adminInstance
      .firestore()
      .doc(actionPath)
      .set(
        dataToSet,
        options?.merge
          ? ({ merge: options?.merge } as FirebaseFirestore.SetOptions)
          : (undefined as any),
      )
      .catch(handleError);
  }
  // "update" action
  return (slashPathToFirestoreRef(
    adminInstance.firestore(),
    actionPath,
    options,
  ) as any)
    [action](dataToSet)
    .catch(handleError);
}

/**
 * Create a custom token
 * @param adminInstance - Admin SDK instance
 * @param uid - UID of user for which the custom token will be generated
 * @param settings - Settings object
 * @returns Promise which resolves with a custom Firebase Auth token
 */
export function createCustomToken(
  adminInstance: any,
  uid: string,
  settings?: any,
): Promise<string> {
  // Use custom claims or default to { isTesting: true }
  const customClaims = settings?.customClaims || { isTesting: true };

  // Create auth token
  return adminInstance.auth().createCustomToken(uid, customClaims);
}

/**
 * Get Firebase Auth user based on UID
 * @param adminInstance - Admin SDK instance
 * @param uid - UID of user for which the custom token will be generated
 * @returns Promise which resolves with a custom Firebase Auth token
 */
export function getAuthUser(
  adminInstance: any,
  uid: string,
): Promise<admin.auth.UserRecord> {
  return adminInstance.auth().getUser(uid);
}
