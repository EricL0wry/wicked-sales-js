require('dotenv/config');
const express = require('express');

const db = require('./database');
const ClientError = require('./client-error');
const staticMiddleware = require('./static-middleware');
const sessionMiddleware = require('./session-middleware');

const app = express();

app.use(staticMiddleware);
app.use(sessionMiddleware);

app.use(express.json());

app.get('/api/health-check', (req, res, next) => {
  db.query('select \'successfully connected\' as "message"')
    .then(result => res.json(result.rows[0]))
    .catch(err => next(err));
});

app.get('/api/products', (req, res, next) => {
  const sql = `
    select "productId",
           "name",
           "price",
           "image",
           "shortDescription",
           "bandName"
      from "products"
  `;

  db.query(sql)
    .then(result => res.json(result.rows))
    .catch(err => next(err));
});

app.get('/api/products/:productId', (req, res, next) => {
  const sql = `
    select *
      from "products"
     where "productId" = $1
  `;
  const params = [req.params.productId];

  db.query(sql, params)
    .then(result => {
      const product = result.rows[0];
      if (!product) {
        next(new ClientError(`${params[0]} is not a valid productId`, 404));
      } else {
        res.json(result.rows[0]);
      }
    })
    .catch(err => next(err));
});

app.get('/api/cart', (req, res, next) => {
  const { cartId } = req.session;
  if (cartId) {
    const params = [cartId];
    const cartItems = `
      select "c"."cartItemId",
             "c"."price",
             "p"."productId",
             "p"."image",
             "p"."name",
             "p"."shortDescription",
             "p"."bandName",
             "p"."genre",
             "p"."year"
        from "cartItems" as "c"
        join "products" as "p" using ("productId")
       where "c"."cartId" = $1
    `;
    db.query(cartItems, params)
      .then(result => res.json(result.rows))
      .catch(err => next(err));
  } else {
    res.json([]);
  }
});

app.post('/api/cart', (req, res, next) => {
  const productId = req.body.productId;
  if (!parseInt(productId, 10) || Math.sign(productId) !== 1) {
    next(new ClientError('productId must be a positive integer', 400));
    return;
  }

  const params = [productId];
  const priceCheck = `
    select "price"
      from "products"
     where "productId" = $1
  `;

  db.query(priceCheck, params)
    .then(result => {
      if (!result.rows[0]) {
        throw new ClientError(`unable to locate productId ${productId}`, 400);
      } else {
        const { price } = result.rows[0];
        const { cartId } = req.session;
        if (cartId) {
          return { cartId, price };
        } else {
          const newCart = `
            insert into "carts" ("cartId", "createdAt")
            values (default, default)
            returning "cartId"
          `;
          return db.query(newCart)
            .then(result => {
              const { cartId } = result.rows[0];
              return { cartId, price };
            })
            .catch(err => next(err));
        }
      }
    })
    .then(result => {
      const { cartId, price } = result;
      req.session.cartId = cartId;
      const params = [cartId, productId, price];
      const cartItem = `
        insert into "cartItems" ("cartId", "productId", "price")
        values ($1, $2, $3)
        returning "cartItemId"
      `;
      return db.query(cartItem, params)
        .then(result => {
          const { cartItemId } = result.rows[0];
          return cartItemId;
        })
        .catch(err => next(err));
    })
    .then(result => {
      const cartItemId = result;
      const params = [cartItemId];
      const cartItems = `
      select "c"."cartItemId",
             "c"."price",
             "p"."productId",
             "p"."image",
             "p"."name",
             "p"."shortDescription",
             "p"."bandName",
             "p"."genre",
             "p"."year"
        from "cartItems" as "c"
        join "products" as "p" using ("productId")
       where "c"."cartItemId" = $1
      `;

      return db.query(cartItems, params)
        .then(result => {
          res.status(201).json(result.rows[0]);
        })
        .catch(err => next(err));
    })
    .catch(err => next(err));
});

app.post('/api/orders', (req, res, next) => {
  const { cartId } = req.session;
  const { name, creditCard, shippingAddress } = req.body;
  if (!cartId) {
    return next(new ClientError('valid cartId is required', 400));
  }
  if (!name) {
    return next(new ClientError('a customer name is required', 400));
  }
  if (!creditCard) {
    return next(new ClientError('a credit card is required', 400));
  }
  if (!shippingAddress) {
    return next(new ClientError('a shipping address is required', 400));
  }

  const params = [cartId, name, creditCard, shippingAddress];
  const order = `
       insert into "orders" ("cartId", "name", "creditCard", "shippingAddress")
       values ($1, $2, $3, $4)
    returning "orderId",
              "createdAt",
              "name",
              "creditCard",
              "shippingAddress";
  `;

  db.query(order, params)
    .then(result => {
      delete req.session.cartId;
      res.status(201).json(result.rows[0]);
    })
    .catch(err => next(err));
});

app.use('/api', (req, res, next) => {
  next(new ClientError(`cannot ${req.method} ${req.originalUrl}`, 404));
});

app.use((err, req, res, next) => {
  if (err instanceof ClientError) {
    res.status(err.status).json({ error: err.message });
  } else {
    console.error(err);
    res.status(500).json({
      error: 'an unexpected error occurred'
    });
  }
});

app.listen(process.env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log('Listening on port', process.env.PORT);
});
